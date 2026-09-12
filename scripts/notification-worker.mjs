import { setTimeout as delay } from "node:timers/promises";

const baseUrl = process.env.WORKER_APP_URL ?? process.env.APP_URL ?? "http://localhost:8080";
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("Set CRON_SECRET before starting the notification worker.");
let stopping = false;
const shutdown = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { stopping = true; shutdown.abort(); });

async function processEndpoint(path) {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

console.info("Voltic PMS notification worker started: deadline checks every 15 minutes, email delivery every minute.");
let nextDeadlineCheck = 0;
while (!stopping) {
  if (Date.now() >= nextDeadlineCheck) {
    try {
      const result = await processEndpoint("/api/notifications/process");
      if (result.notificationsCreated) console.info(`Created ${result.notificationsCreated} deadline notifications.`);
      nextDeadlineCheck = Date.now() + 15 * 60_000;
    } catch (error) { console.error("Deadline check failed; retrying in one minute.", error.message); }
  }
  try { await processEndpoint("/api/mail/process"); }
  catch (error) { console.error("Mail processing failed; retrying in one minute.", error.message); }
  if (!stopping) await delay(60_000, undefined, { signal: shutdown.signal }).catch(() => {});
}
