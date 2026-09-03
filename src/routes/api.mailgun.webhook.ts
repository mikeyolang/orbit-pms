import { createHmac, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { getServerConfig } from "@/lib/config.server";
import { getDb } from "@/server/db/client.server";
import { mailEvents, mailSuppressions } from "@/server/db/schema";

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const Route = createFileRoute("/api/mailgun/webhook")({ server: { handlers: { POST: async ({ request }) => {
  const key = getServerConfig().mailgunWebhookSigningKey;
  if (!key) return Response.json({ error: "Webhook is not configured" }, { status: 503 });
  const contentType = request.headers.get("content-type") ?? "";
  const raw: any = contentType.includes("application/json") ? await request.json() : Object.fromEntries(await request.formData());
  const signature = raw.signature ?? raw;
  const timestamp = String(signature.timestamp ?? "");
  const token = String(signature.token ?? "");
  const supplied = String(signature.signature ?? "");
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  const expected = createHmac("sha256", key).update(timestamp + token).digest("hex");
  if (!timestamp || !token || !supplied || age > 900 || !safeEqual(expected, supplied)) return Response.json({ error: "Invalid signature" }, { status: 401 });
  const eventData = raw["event-data"] ?? raw.eventData ?? raw;
  const event = String(eventData.event ?? "unknown");
  const recipient = String(eventData.recipient ?? eventData.message?.headers?.to ?? "").toLowerCase() || null;
  const providerEventId = String(eventData.id ?? `${timestamp}:${token}`);
  const providerMessageId = eventData.message?.headers?.["message-id"] ?? null;
  await getDb().insert(mailEvents).values({ providerEventId, event, recipient, providerMessageId, payload: eventData }).onConflictDoNothing();
  const severity = eventData.severity;
  if (recipient && (event === "complained" || (event === "failed" && severity === "permanent"))) {
    await getDb().insert(mailSuppressions).values({ recipient, reason: event === "complained" ? "complaint" : "hard-bounce" }).onConflictDoUpdate({ target: mailSuppressions.recipient, set: { reason: event === "complained" ? "complaint" : "hard-bounce", createdAt: new Date() } });
  }
  return Response.json({ accepted: true });
} } } });
