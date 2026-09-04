import { and, eq, lt, sql } from "drizzle-orm";
import nodemailer from "nodemailer";
import { getServerConfig, requireServerConfig } from "@/lib/config.server";
import { getDb } from "@/server/db/client.server";
import { mailOutbox, mailSuppressions } from "@/server/db/schema";

export type TransactionalEmail = { kind: string; to: string; subject: string; text: string; html?: string };

export function escapeEmailHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function brandedEmail(subject: string, text: string, content?: string) {
  const safeText = escapeEmailHtml(text).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#1B3673;text-decoration:underline">$1</a>').replaceAll("\n", "<br>");
  const styledContent = content?.replaceAll("<p>", '<p style="margin:0 0 18px">').replaceAll("<a href=", '<a style="display:inline-block;background:#1B3673;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px" href=');
  return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Inter,Arial,sans-serif;color:#182033"><div style="display:none;max-height:0;overflow:hidden">${escapeEmailHtml(subject)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden"><tr><td style="padding:24px 32px;background:#111827"><div style="font-size:20px;font-weight:700;color:#fff"><span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;border-radius:8px;background:#1B3673;margin-right:10px">O</span>Orbit</div></td></tr><tr><td style="padding:32px"><h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#111827">${escapeEmailHtml(subject)}</h1><div style="font-size:15px;line-height:1.7;color:#4b5563">${styledContent ?? `<p style="margin:0">${safeText}</p>`}</div></td></tr><tr><td style="padding:20px 32px;border-top:1px solid #eef0f4;font-size:12px;line-height:1.5;color:#9ca3af">This is an automated message from Orbit. If you were not expecting it, you can safely ignore it.</td></tr></table></td></tr></table></body></html>`;
}

export async function sendTransactionalEmail(message: TransactionalEmail) {
  const [suppressed] = await getDb().select().from(mailSuppressions).where(eq(mailSuppressions.recipient, message.to.toLowerCase())).limit(1);
  if (suppressed) return { id: "suppressed", mode: "suppressed" as const };
  const [queued] = await getDb().insert(mailOutbox).values({ kind: message.kind, recipient: message.to.toLowerCase(), subject: message.subject, textBody: message.text, htmlBody: brandedEmail(message.subject, message.text, message.html) }).returning({ id: mailOutbox.id });
  if (["smtp", "log"].includes(getServerConfig().mailMode)) await processMailOutbox(20);
  return { id: queued.id, mode: "queued" as const };
}

async function deliver(message: typeof mailOutbox.$inferSelect) {
  const config = getServerConfig();
  if (config.mailMode === "log") {
    console.info("[mail]", { kind: message.kind, to: message.recipient, subject: message.subject });
    return "local-log";
  }
  if (config.mailMode === "smtp") {
    const transport = nodemailer.createTransport({ host: config.mailSmtpHost, port: config.mailSmtpPort, secure: false });
    const result = await transport.sendMail({ from: config.mailFrom ?? "Orbit <notifications@orbit.local>", to: message.recipient, subject: message.subject, text: message.textBody, html: message.htmlBody ?? undefined });
    return result.messageId;
  }
  const { mailgunApiKey, mailgunDomain, mailgunBaseUrl, mailFrom } = requireServerConfig("mailgunApiKey", "mailgunDomain", "mailgunBaseUrl", "mailFrom");
  const body = new FormData();
  body.set("from", mailFrom); body.set("to", message.recipient); body.set("subject", message.subject); body.set("text", message.textBody);
  if (message.htmlBody) body.set("html", message.htmlBody);
  body.set("o:tag", message.kind);
  if (config.mailMode === "test") body.set("o:testmode", "yes");
  const authorization = Buffer.from(`api:${mailgunApiKey}`).toString("base64");
  const response = await fetch(`${mailgunBaseUrl}/v3/${mailgunDomain}/messages`, { method: "POST", headers: { Authorization: `Basic ${authorization}` }, body });
  if (!response.ok) throw new Error(`Mailgun request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return ((await response.json()) as { id: string }).id;
}

export async function processMailOutbox(batchSize = 20) {
  const db = getDb();
  const pending = await db.select().from(mailOutbox).where(and(eq(mailOutbox.status, "pending"), lt(mailOutbox.attempts, 5))).limit(batchSize);
  let sent = 0;
  for (const message of pending) {
    try {
      const providerMessageId = await deliver(message);
      await db.update(mailOutbox).set({ status: "sent", providerMessageId, sentAt: new Date(), attempts: sql`${mailOutbox.attempts} + 1`, lastError: null }).where(eq(mailOutbox.id, message.id));
      sent++;
    } catch (error) {
      const attempts = message.attempts + 1;
      await db.update(mailOutbox).set({ status: attempts >= 5 ? "failed" : "pending", attempts, lastError: error instanceof Error ? error.message.slice(0, 1000) : "Delivery failed" }).where(eq(mailOutbox.id, message.id));
    }
  }
  return { examined: pending.length, sent };
}
