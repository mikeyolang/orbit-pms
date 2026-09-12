import type { PoolClient } from "pg";
import { getServerConfig } from "@/lib/config.server";
import { brandedEmail } from "./mail/mailgun.server";

// Called in the comment transaction, after its trigger has resolved mention
// recipients and checked project access. A failed queue insert rolls back the send.
export async function queueTaskMentionEmails(client: PoolClient, commentIds: string[]) {
  if (!commentIds.length) return;
  const notices = await client.query(`SELECT n.title,n.body,n.href,n.dedupe_key,u.email
    FROM system_notifications n JOIN "user" u ON u.id=n.user_id
    WHERE n.kind='task-mention' AND n.dedupe_key=ANY($1::text[])
      AND NOT EXISTS(SELECT 1 FROM mail_suppressions s WHERE s.recipient=lower(u.email))`,
    [commentIds.map((id) => `task-chat:${id}`)]);
  for (const notice of notices.rows) {
    const text = `${notice.body}\n\nOpen task chat: ${getServerConfig().appUrl}${notice.href}`;
    await client.query(`INSERT INTO mail_outbox(kind,recipient,subject,text_body,html_body,metadata)
      VALUES('task-mention',lower($1),$2,$3,$4,$5)`,
      [notice.email, notice.title, text, brandedEmail(notice.title, text), JSON.stringify({ notificationKey: notice.dedupe_key })]);
  }
}
