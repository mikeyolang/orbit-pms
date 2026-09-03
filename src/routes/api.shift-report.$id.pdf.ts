import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@/server/auth.server";
import { getPool } from "@/server/db/client.server";
import { createShiftReportPdf } from "@/server/pdf/shift-report-pdf.server";

export const Route = createFileRoute("/api/shift-report/$id/pdf")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await getAuth().api.getSession({ headers: request.headers });
        if (!session?.user) return new Response("Unauthorized", { status: 401 });
        const pool = getPool();
        const result = await pool.query(
          `SELECT r.*,o.name workspace,p.full_name,p.email,s.start_at,s.end_at,st.label shift_type FROM shift_reports r
           JOIN organizations o ON o.id=r.organization_id JOIN shifts s ON s.id=r.shift_id
           LEFT JOIN shift_types st ON st.id=s.shift_type_id LEFT JOIN profiles p ON p.id=r.user_id
           WHERE r.id=$1 AND (r.user_id=$2 OR has_permission(r.organization_id,$2,'shifts.approve'))`,
          [params.id, session.user.id],
        );
        const report = result.rows[0];
        if (!report) return new Response("Not found", { status: 404 });
        const lines = await pool.query(
          `SELECT b.name company,c.tickets_sold tickets,c.total_value value,c.cancelled_tickets cancelled,
                  c.chats_received,c.chats_handled,c.chats_missed
           FROM shift_report_companies c JOIN bus_companies b ON b.id=c.company_id
           WHERE c.report_id=$1 ORDER BY b.name`,
          [report.id],
        );
        const pdf = createShiftReportPdf({
          workspace: report.workspace,
          employee: report.full_name ?? report.email,
          email: report.email ?? "",
          shift: `${report.shift_type ?? "Shift"} | ${new Date(report.start_at).toLocaleString()} - ${new Date(report.end_at).toLocaleString()}`,
          checkedIn: report.checked_in_at ? new Date(report.checked_in_at).toLocaleString() : "Not recorded",
          checkedOut: new Date(report.checked_out_at).toLocaleString(),
          unreached: report.unreached_clients,
          vouchers: report.vouchers_issued,
          cancelled: report.cancelled_tickets,
          chatsReceived: report.total_chats_received,
          chatsHandled: report.total_chats_handled,
          chatsMissed: report.total_chats_missed,
          totalTickets: report.total_tickets,
          totalValue: String(report.total_value),
          handover: report.handover_notes ?? "",
          lines: lines.rows,
        });
        return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename=shift-report-${report.id}.pdf` } });
      },
    },
  },
});
