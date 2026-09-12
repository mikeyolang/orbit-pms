# Docker deployment to pms.helapay.africa

The production stack exposes Orbit at `http://pms.helapay.africa`. The server's system Nginx is the public gateway; the Orbit container listens only on `127.0.0.1:8080`, and PostgreSQL is available only on the private Docker network. The one-off `migrate` service applies pending Drizzle migrations before the application starts.

## First deployment

1. Connect to the server and install Docker:

   ```sh
   ssh root@165.227.150.123
   apt update
   apt install -y docker.io docker-compose-plugin git
   systemctl enable --now docker
   ```

2. Clone the repository and enter it:

   ```sh
   git clone YOUR_REPOSITORY_URL orbit-pms
   cd orbit-pms
   ```

3. Create the private production environment file:

   ```sh
   cp .env.production.example .env.production
   chmod 600 .env.production
   nano .env.production
   ```

   Generate the database password with `openssl rand -hex 32`. Generate the Better Auth and cron secrets separately with `openssl rand -base64 48`. Replace the SMTP password placeholder with the mailbox password. Do not commit `.env.production`.

4. Allow SSH and the temporary application port:

   ```sh
   ufw allow OpenSSH
   ufw allow 80/tcp
   ufw enable
   ```

   Also allow TCP port 80 in the hosting provider's cloud firewall, if one is enabled. Never expose PostgreSQL port 5432.

5. Build and start the complete stack:

   ```sh
   docker compose --env-file .env.production -f compose.production.yaml up -d --build
   ```

6. Check the result:

   ```sh
   docker compose --env-file .env.production -f compose.production.yaml ps
   docker compose --env-file .env.production -f compose.production.yaml logs --tail=100 app
   curl http://127.0.0.1:8080/api/health
   ```

   Open `http://pms.helapay.africa` in a browser.

## Scheduled notification processing

Run `crontab -e` on the server and add the following lines, replacing `YOUR_CRON_SECRET` with the value in `.env.production`:

```cron
* * * * * curl -fsS -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" http://127.0.0.1:8080/api/mail/process >/dev/null 2>&1
*/15 * * * * curl -fsS -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" http://127.0.0.1:8080/api/notifications/process >/dev/null 2>&1
```

## Future deployments

```sh
cd orbit-pms
git pull
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml ps
```

The migration container runs again and applies only pending migrations. PostgreSQL data remains in the named Docker volume.

## Important limitation

This temporary deployment uses unencrypted HTTP. Do not treat it as a secure public production system. Add a domain and HTTPS before users enter sensitive data.

The Compose stack now includes `notification-worker` for deadline checks and email delivery. The manual cron entries above are only an alternative; do not run them alongside the worker.
