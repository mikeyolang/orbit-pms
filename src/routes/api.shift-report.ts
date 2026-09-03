import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@/server/auth.server";
import { getPool } from "@/server/db/client.server";
import { getServerConfig } from "@/lib/config.server";
import { escapeEmailHtml, sendTransactionalEmail } from "@/server/mail/mailgun.server";

type CompanyMetrics = {
  companyId: string;
  ticketsSold: number;
  totalValue: number;
  cancelledTickets: number;
  chatsReceived: number;
  chatsHandled: number;
  chatsMissed: number;
};

const count = (value: number) => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
const amount = (value: number) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export const Route = createFileRoute("/api/shift-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getAuth().api.getSession({ headers: request.headers });
        if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json() as {
          shiftId: string;
          unreachedClients: number;
          vouchersIssued: number;
          handoverNotes?: string;
          companies: CompanyMetrics[];
        };
        const lines = (body.companies ?? []).map((line) => ({
          companyId: line.companyId,
          ticketsSold: count(line.ticketsSold),
          totalValue: amount(line.totalValue),
          cancelledTickets: count(line.cancelledTickets),
          chatsReceived: count(line.chatsReceived),
          chatsHandled: count(line.chatsHandled),
          chatsMissed: count(line.chatsMissed),
        })).filter((line) => line.ticketsSold || line.totalValue || line.cancelledTickets || line.chatsReceived || line.chatsHandled || line.chatsMissed);
        const totals = lines.reduce((sum, line) => ({
          tickets: sum.tickets + line.ticketsSold,
          value: sum.value + line.totalValue,
          cancelled: sum.cancelled + line.cancelledTickets,
          received: sum.received + line.chatsReceived,
          handled: sum.handled + line.chatsHandled,
          missed: sum.missed + line.chatsMissed,
        }), { tickets: 0, value: 0, cancelled: 0, received: 0, handled: 0, missed: 0 });

        const client = await getPool().connect();
        let reportId = "";
        let workspaceName = "Workspace";
        let recipients: { user_id: string; email: string | null }[] = [];
        try {
          await client.query("BEGIN");
          const found = await client.query("SELECT s.*,o.name workspace_name FROM shifts s JOIN organizations o ON o.id=s.organization_id WHERE s.id=$1 FOR UPDATE", [body.shiftId]);
          const shift = found.rows[0];
          if (!shift || shift.user_id !== session.user.id) throw new Error("Only the assigned member can check out this shift");
          if (shift.status === "ended") throw new Error("This shift is already checked out");
          workspaceName = shift.workspace_name;

          const report = await client.query(
            `INSERT INTO shift_reports(shift_id,organization_id,user_id,checked_in_at,unreached_clients,vouchers_issued,cancelled_tickets,total_tickets,total_value,total_chats_received,total_chats_handled,total_chats_missed,handover_notes)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
            [shift.id, shift.organization_id, session.user.id, shift.started_at, count(body.unreachedClients), count(body.vouchersIssued), totals.cancelled, totals.tickets, totals.value, totals.received, totals.handled, totals.missed, body.handoverNotes?.trim() || null],
          );
          reportId = report.rows[0].id;
          for (const line of lines) {
            const inserted = await client.query(
              `INSERT INTO shift_report_companies(report_id,company_id,tickets_sold,total_value,cancelled_tickets,chats_received,chats_handled,chats_missed)
               SELECT $1,b.id,$3,$4,$5,$6,$7,$8 FROM bus_companies b WHERE b.id=$2 AND b.organization_id=$9`,
              [reportId, line.companyId, line.ticketsSold, line.totalValue, line.cancelledTickets, line.chatsReceived, line.chatsHandled, line.chatsMissed, shift.organization_id],
            );
            if (!inserted.rowCount) throw new Error("A selected bus company does not belong to this workspace");
          }
          await client.query("UPDATE shifts SET status='ended',ended_at=now(),end_comment=$2 WHERE id=$1", [shift.id, body.handoverNotes?.trim() || null]);
          const admins = await client.query(
            `SELECT m.user_id,COALESCE(p.email,u.email) email FROM organization_members m
             JOIN "user" u ON u.id=m.user_id LEFT JOIN profiles p ON p.id=m.user_id
             WHERE m.organization_id=$1 AND (m.role IN ('owner','admin') OR (m.role='manager' AND m.can_access_shifts))`,
            [shift.organization_id],
          );
          recipients = admins.rows;
          const summary = `${totals.tickets} tickets · ${totals.cancelled} cancelled · ${totals.received} chats received · ${totals.handled} handled · ${totals.missed} missed`;
          for (const admin of recipients) await client.query(
            "INSERT INTO system_notifications(user_id,kind,title,body,href,dedupe_key) VALUES($1,'shift-report',$2,$3,$4,$5) ON CONFLICT(user_id,dedupe_key) DO NOTHING",
            [admin.user_id, `Shift report - ${session.user.name}`, summary, `/api/shift-report/${reportId}/pdf`, `shift-report:${reportId}`],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          return Response.json({ error: error instanceof Error ? error.message : "Unable to save report" }, { status: 400 });
        } finally {
          client.release();
        }

        const link = `${getServerConfig().appUrl}/api/shift-report/${reportId}/pdf`;
        const name = session.user.name || session.user.email;
        const plainSummary = `Tickets: ${totals.tickets}\nTicket value: ${totals.value.toFixed(2)}\nCancelled tickets: ${totals.cancelled}\nChats received: ${totals.received}\nChats handled: ${totals.handled}\nChats missed: ${totals.missed}\nUnreached clients: ${count(body.unreachedClients)}\nVouchers: ${count(body.vouchersIssued)}`;
        for (const recipient of recipients) if (recipient.email) {
          try {
            await sendTransactionalEmail({
              kind: "shift-report",
              to: recipient.email,
              subject: `Shift report - ${name}`,
              text: `${name} checked out from ${workspaceName}.\n\n${plainSummary}\n\nPDF: ${link}`,
              html: `<p><strong>${escapeEmailHtml(name)}</strong> completed a shift report for <strong>${escapeEmailHtml(workspaceName)}</strong>.</p><p>Tickets: <strong>${totals.tickets}</strong><br>Ticket value: <strong>${totals.value.toFixed(2)}</strong><br>Cancelled tickets: <strong>${totals.cancelled}</strong><br>Chats received: <strong>${totals.received}</strong><br>Chats handled: <strong>${totals.handled}</strong><br>Chats missed: <strong>${totals.missed}</strong><br>Unreached clients: ${count(body.unreachedClients)}<br>Vouchers issued: ${count(body.vouchersIssued)}</p><p><a href="${link}">Open PDF report</a></p>`,
            });
          } catch (error) {
            console.error("Shift report email failed", error);
          }
        }
        return Response.json({ ok: true, reportId });
      },
    },
  },
});
