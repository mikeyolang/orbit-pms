import { getServerConfig } from "@/lib/config.server";
import { getPool } from "./db/client.server";
import { escapeEmailHtml, sendTransactionalEmail } from "./mail/mailgun.server";

export async function notifyShiftSwapAccepted(requestId: string) {
  const result = await getPool().query(
    `SELECT r.id,r.from_user_id,r.to_user_id,r.preferred_start_at,r.preferred_end_at,
            s.start_at,s.end_at,COALESCE(st.label,'Shift') AS shift_label,
            COALESCE(requester_profile.email,requester.email) AS requester_email,
            COALESCE(NULLIF(replacement_profile.full_name,''),NULLIF(replacement.name,''),replacement.email) AS replacement_name
       FROM shift_swap_requests r
       JOIN shifts s ON s.id=r.from_shift_id
       LEFT JOIN shift_types st ON st.id=s.shift_type_id
       JOIN "user" requester ON requester.id=r.from_user_id
       LEFT JOIN profiles requester_profile ON requester_profile.id=requester.id
       LEFT JOIN "user" replacement ON replacement.id=r.to_user_id
       LEFT JOIN profiles replacement_profile ON replacement_profile.id=replacement.id
      WHERE r.id=$1 AND r.status='accepted'`,
    [requestId],
  );
  const swap = result.rows[0];
  if (!swap) return false;

  const replacementName = swap.replacement_name ?? "a teammate";
  const schedule = `${new Date(swap.start_at).toLocaleString()} – ${new Date(swap.end_at).toLocaleString()}`;
  const inserted = await getPool().query(
    `INSERT INTO system_notifications(user_id,kind,title,body,href,dedupe_key)
     VALUES($1,'shift-swap-accepted','Shift request accepted',$2,'/app/shifts',$3)
     ON CONFLICT(user_id,dedupe_key) DO NOTHING RETURNING id`,
    [swap.from_user_id, `${replacementName} accepted your ${swap.shift_label} request. The shift is now scheduled for ${schedule}.`, `shift-swap-accepted:${swap.id}`],
  );

  if (inserted.rowCount && swap.requester_email) {
    const url = `${getServerConfig().appUrl}/app/shifts`;
    await sendTransactionalEmail({
      kind: "shift-swap-accepted",
      to: swap.requester_email,
      subject: `Shift request accepted: ${swap.shift_label}`,
      text: `${replacementName} accepted your shift request. The shift is now scheduled for ${schedule}. View your shifts: ${url}`,
      html: `<p><strong>${escapeEmailHtml(replacementName)}</strong> accepted your shift request.</p><p><strong>${escapeEmailHtml(swap.shift_label)}</strong><br>${escapeEmailHtml(schedule)}</p><p><a href="${url}">View your shifts</a></p>`,
    });
  }
  return inserted.rowCount > 0;
}
