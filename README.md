# Orbit PMS

Orbit PMS is a TanStack Start application backed by PostgreSQL. The local stack uses Docker Compose for PostgreSQL and Mailpit; production builds target Cloudflare Workers.

## Run locally

### Prerequisites

- Node.js 22 or newer and npm
- Docker Desktop, or another Docker Compose-compatible runtime

### Setup

1. Install the JavaScript dependencies:

   ```sh
   npm ci
   ```

2. Create the local environment file:

   ```sh
   cp .env.example .env
   ```

3. In `.env`, replace `BETTER_AUTH_SECRET` and `CRON_SECRET` with unique values. You can generate each value with:

   ```sh
   openssl rand -base64 32
   ```

   The example file is already configured for the local PostgreSQL and Mailpit services. Keep secrets in `.env`; variables prefixed with `VITE_` are included in browser code and must never contain credentials.

4. Start PostgreSQL and Mailpit:

   ```sh
   docker compose up -d
   ```

5. Apply the database migrations and optionally create the demo workspace:

   ```sh
   npm run db:migrate
   npm run db:seed
   ```

6. Start the development server:

   ```sh
   npm run dev
   ```

Open <http://localhost:8080>. The database health check is available at <http://localhost:8080/api/health>, and captured development email can be viewed in Mailpit at <http://localhost:8025>.

### Demo login

Running `npm run db:seed` creates one verified local demo account and makes it the owner of **Orbit Demo Workspace**:

| Field | Value |
| --- | --- |
| Email | `demo@orbit.local` |
| Password | `OrbitDemo123!` |
| Workspace role | `Owner` |

These credentials are for local development only. To use a different demo account, edit `SEED_USER_EMAIL`, `SEED_USER_NAME`, and `SEED_USER_PASSWORD` in `.env` before running the seed command. Running the seed command again updates the configured demo user's password.

To stop the local services, run:

```sh
docker compose down
```

The PostgreSQL data is retained in a Docker volume. Use `docker compose down -v` only when you deliberately want to delete the local database.

## Build locally

Create a production build with:

```sh
npm run build
```

The deployable Worker and static assets are written to `.output/`. To inspect the production build locally, run:

```sh
npm run preview
```

## Publish to a live server

The generated production target is Cloudflare Workers. You need a Cloudflare account, Wrangler access, a production PostgreSQL database reachable by the Worker, and a real HTTPS domain for the application.

### 1. Prepare the production database

Provision a managed PostgreSQL database. For Cloudflare, use Hyperdrive where appropriate and make its connection string available to the application as `DATABASE_URL`. Do not point the deployed app at PostgreSQL running on a developer computer.

From a trusted administrative machine or CI job, apply migrations once using the production connection string:

```sh
DATABASE_URL='postgresql://…' npm run db:migrate
```

Do not run migrations automatically on every Worker startup. Back up an existing production database before applying new migrations.

### 2. Configure Cloudflare

Authenticate Wrangler:

```sh
npx wrangler login
```

After the first production build, the generated configuration is `.output/server/wrangler.json`. Its default Worker name is `mikeyolang-orbit-pms`; change that generated name before deployment if the Cloudflare account requires a different name. Because `.output` is regenerated, make the same adjustment after subsequent builds or add a permanent project-level Wrangler configuration.

Store server configuration in Cloudflare's secret manager. Repeat the following command for each value, entering it only at Wrangler's prompt:

```sh
npx wrangler secret put DATABASE_URL --config .output/server/wrangler.json
npx wrangler secret put BETTER_AUTH_SECRET --config .output/server/wrangler.json
npx wrangler secret put APP_URL --config .output/server/wrangler.json
npx wrangler secret put TRUSTED_ORIGINS --config .output/server/wrangler.json
npx wrangler secret put CRON_SECRET --config .output/server/wrangler.json
```

Set `APP_URL` to the exact public origin, for example `https://orbit.example.com`. Set `TRUSTED_ORIGINS` to a comma-separated list of any additional legitimate origins; do not use wildcards.

For production email through Mailgun, also set `MAIL_MODE=send`, `MAILGUN_API_KEY`, `MAILGUN_WEBHOOK_SIGNING_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_BASE_URL`, and `MAIL_FROM`. `HR_WEBHOOK_SECRET` is required only when the HR webhook integration is used.

### 3. Build and deploy

`VITE_APP_URL` is public browser configuration and is embedded at build time. Build with the live origin, then deploy the generated Worker:

```sh
VITE_APP_URL='https://orbit.example.com' npm run build
npx wrangler deploy --config .output/server/wrangler.json
```

In Cloudflare, attach the production custom domain to the deployed Worker. If a CI/CD service performs deployments, use the same build command and deploy `.output/server/index.mjs` with the static assets in `.output/public`, or run the Wrangler command above.

### 4. Production follow-up

- Confirm `https://YOUR_DOMAIN/api/health` returns `{"status":"ok","database":"connected"}`.
- Test registration, sign-in, password reset, tenant isolation, and the main project/task flows.
- Register `https://YOUR_DOMAIN/api/mailgun/webhook` in Mailgun when email delivery is enabled.
- Schedule authenticated `POST` requests to `/api/mail/process` every minute and `/api/notifications/process` daily, using `Authorization: Bearer YOUR_CRON_SECRET`.
- Keep production secrets out of Git, `.env.example`, build logs, and all `VITE_` variables.
- Never seed the documented local demo account into staging or production.

For the detailed database cutover and email-delivery procedures, see [docs/database-migration.md](docs/database-migration.md) and [docs/email-notification-testing.md](docs/email-notification-testing.md).
