# PostgreSQL migration runbook

The application is being moved from direct Supabase access to a server-owned PostgreSQL connection.
Supabase remains the active application backend until each feature is moved and accepted.

## Local setup

1. Install Docker Desktop or another Compose-compatible container runtime.
2. Copy `.env.example` to `.env` and replace both generated secrets.
3. Start PostgreSQL and Mailpit with `docker compose up -d`.
4. Apply migrations with `npm run db:migrate`.
5. Add demo workspace data with `npm run db:seed`.
6. Start the application with `npm run dev`.
7. Check <http://localhost:8080/api/health> and open Mailpit at <http://localhost:8025>. Queued messages are delivered by calling `POST /api/mail/process` with `Authorization: Bearer $CRON_SECRET`.

Do not point a deployed environment at the PostgreSQL instance on a developer laptop.
The container publishes PostgreSQL on `127.0.0.1:5433` to avoid colliding with an existing service on the standard port `5432`. The explicit IPv4 address also avoids `localhost` resolving to an IPv6 address that Docker is not listening on.

## Environment modes

- `MAIL_MODE=smtp`: sends only to local Mailpit (the recommended local default).
- `MAIL_MODE=log`: logs recipient and subject metadata without sending.
- `MAIL_MODE=test`: calls Mailgun with test mode enabled; no delivery occurs.
- `MAIL_MODE=send`: sends through Mailgun.

Database and Mailgun credentials are server-only and must never use a `VITE_` prefix.
The default local seed login is `demo@orbit.local` / `OrbitDemo123!`. Override it with the `SEED_USER_*` variables and never use these development credentials in staging or production.

## Cutover sequence

1. Export and verify the current Supabase schema and data.
2. Import users while retaining their UUIDs.
3. Import application tables in foreign-key order.
4. Compare row counts and run tenant-isolation acceptance checks.
5. Move one feature at a time to server functions.
6. Use polling while Supabase Realtime is replaced.
7. Freeze writes briefly for the final data delta.
8. Keep Supabase read-only for the rollback window.

### Rehearsal commands

Set `SOURCE_DATABASE_URL` to Supabase's direct PostgreSQL connection string and `DATABASE_URL` to a fresh staging database. Never use a production destination for the first rehearsal.

1. `npm run db:migrate`
2. `npm run db:import-app-schema`
3. `npm run db:migrate-data`
4. `npm run db:verify-migration`

The migration keeps user UUIDs but intentionally does not copy password hashes. Existing users use the password-reset flow after cutover. Run the rehearsal twice against newly restored staging databases, record row-count output, and manually verify organization isolation before scheduling production.

## Mailgun production setup

1. Add and verify a dedicated domain such as `mg.example.com` in Mailgun.
2. Publish the exact SPF and DKIM records Mailgun provides, plus a DMARC record for the parent domain.
3. Store `MAILGUN_API_KEY`, `MAILGUN_WEBHOOK_SIGNING_KEY`, `MAILGUN_DOMAIN`, `MAIL_FROM`, and `CRON_SECRET` in the host secret manager.
4. Set `MAIL_MODE=test` for staging and `MAIL_MODE=send` only after delivery checks pass.
5. Register `https://YOUR_APP/api/mailgun/webhook` for delivered, failed, bounced, and complained events.
6. Schedule `POST /api/mail/process` every minute with the bearer cron secret.
7. Schedule `POST /api/notifications/process` daily with the same bearer cron secret.

See [email-notification-testing.md](./email-notification-testing.md) for the complete safe local acceptance flow.

Webhook signatures are checked with Mailgun's signing key and a 15-minute replay window. Permanent failures and complaints create recipient suppressions. Delivery events, failures, and provider IDs are retained in PostgreSQL.

## Cloudflare production notes

Create a managed PostgreSQL database, connect it through Cloudflare Hyperdrive, and expose its connection string to the server as `DATABASE_URL`. Keep the pool small because each Worker isolate can create its own pool. Set `APP_URL` and `VITE_APP_URL` to the exact HTTPS origin and list any additional legitimate origins in `TRUSTED_ORIGINS`; do not use wildcards. Apply migrations from CI or an administrative machine, not from every Worker startup.

Before switching traffic, enable a write-maintenance page, take a final Supabase backup, run the final migration and count verification, deploy, check login/project/task/email flows, and then restore writes. Keep the Supabase project read-only for the agreed rollback period.

## Implemented status

- Local PostgreSQL and Mailpit Compose services: ready.
- Drizzle configuration and initial schema: ready.
- Repeatable local seed and database health endpoint: ready.
- Better Auth database integration and `/api/auth/*` endpoint: ready.
- Browser data access now goes through an authenticated, allowlisted PostgreSQL API; no component connects to Supabase.
- Existing RLS policies run as the Better Auth user inside transaction-local context.
- Active screens use 8-second polling where they previously subscribed to Supabase Realtime.
- Mail is queued in a transactional outbox, supports Mailpit/Mailgun, records signed webhook events, and suppresses hard bounces and complaints.
- Repeatable user/application-data migration and row-count verification scripts are ready.
- The Supabase SDK and runtime integration have been removed. Original SQL migrations remain as an archived migration source.

## Manual acceptance checklist

- Register, verify the Mailpit email, sign in, sign out, and reset a password.
- Create/join an organization and confirm a different organization cannot be read or modified.
- Create and edit projects, tasks, labels, comments, teams, and shifts.
- Exercise invitation, join-request, role override, and shift-swap decisions.
- Confirm boards refresh within 8 seconds and immediately after local mutations.
- Trigger a test Mailgun failure/complaint webhook and confirm future mail to that address is suppressed.
- Restore a database backup into staging and repeat the critical checks.
