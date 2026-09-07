import process from "node:process";

// Server-only config. The .server.ts suffix prevents Vite from bundling
// this file into the client — values here never reach the browser.
//
// On Cloudflare Workers, env binds at REQUEST time. Module-scope reads
// (e.g. `const x = process.env.X`) resolve to undefined — always read
// process.env INSIDE a function or handler.
//
// When to use which env-access pattern:
//   - .server.ts module (this file): server-only helpers reused across
//     handlers. Wrap reads in a function so they run per-request.
//   - inline process.env inside a createServerFn handler: one-off reads
//     not reused elsewhere.
//   - import.meta.env.VITE_FOO: PUBLIC config readable from both client
//     and server (analytics IDs, public URLs). Define in .env with the
//     VITE_ prefix. Never put secrets here — they ship to the browser.

export function getServerConfig() {
  const envBoolean = (value: string | undefined, fallback = false) =>
    value == null ? fallback : ["1", "true", "yes", "on"].includes(value.toLowerCase());
  return {
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
    databaseSsl: envBoolean(process.env.DATABASE_SSL, process.env.NODE_ENV === "production"),
    authSecret: process.env.BETTER_AUTH_SECRET,
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
    trustedOrigins: process.env.TRUSTED_ORIGINS,
    mailgunApiKey: process.env.MAILGUN_API_KEY,
    mailgunDomain: process.env.MAILGUN_DOMAIN,
    mailgunBaseUrl: process.env.MAILGUN_BASE_URL ?? "https://api.mailgun.net",
    mailFrom: process.env.MAIL_FROM,
    mailgunWebhookSigningKey: process.env.MAILGUN_WEBHOOK_SIGNING_KEY,
    mailMode: process.env.MAIL_MODE ?? "log",
    mailSmtpHost: process.env.MAIL_SMTP_HOST ?? "127.0.0.1",
    mailSmtpPort: Number(process.env.MAIL_SMTP_PORT ?? "1025"),
    mailSmtpSecure: envBoolean(process.env.MAIL_SMTP_SECURE),
    mailSmtpRequireTls: envBoolean(process.env.MAIL_SMTP_REQUIRE_TLS),
    mailSmtpUser: process.env.MAIL_SMTP_USER,
    mailSmtpPassword: process.env.MAIL_SMTP_PASSWORD,
    mailSmtpTimeout: Number(process.env.MAIL_SMTP_TIMEOUT ?? "30000"),
    cronSecret: process.env.CRON_SECRET,
    hrWebhookSecret: process.env.HR_WEBHOOK_SECRET,
  };
}

export function requireServerConfig<K extends keyof ReturnType<typeof getServerConfig>>(
  ...keys: K[]
): Required<Pick<ReturnType<typeof getServerConfig>, K>> & ReturnType<typeof getServerConfig> {
  const config = getServerConfig();
  const missing = keys.filter((key) => !config[key]);
  if (missing.length) throw new Error(`Missing server configuration: ${missing.join(", ")}`);
  return config as Required<Pick<typeof config, K>> & typeof config;
}
