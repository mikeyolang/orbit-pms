# Email and notification testing with Mailpit

Keep `MAIL_MODE=smtp` locally. Mail is delivered only to Mailpit at <http://localhost:8025>; no external recipient receives it.

## Start the environment

```bash
docker compose up -d
npm run db:migrate
npm run dev
```

## Verification and password reset

1. Register with any realistic test address.
2. Open Mailpit and open the **Verify your Orbit email** message.
3. Click its verification link, then sign in.
4. Sign out and use **Forgot password**. Open the reset message in Mailpit and complete the reset.

## Workspace invitation

1. Sign in as an owner or administrator.
2. Open **People & Roles**, enter the teammate's email and select a role.
3. The teammate opens the invitation email in Mailpit.
4. They sign in with the same verified email, review the invitation, then accept or decline it.

Workspace join codes are no longer presented. Membership is granted only through a personal email invitation.

## Shift request

1. Assign shifts to two verified test users.
2. Sign in as the first user and create a direct shift-swap request for the second user.
3. Open the request email in Mailpit and follow **Review request**.
4. Sign in as the intended recipient and accept or decline. Unauthorized users are rejected by the server.

Open and coverage requests remain visible on the swap board because they do not have one predetermined email recipient. Direct requests are emailed to their selected recipient.

## Overdue alerts

Run the protected notification scan after creating an overdue active project or unfinished overdue task:

```bash
curl -X POST http://localhost:8080/api/notifications/process \
  -H 'Authorization: Bearer orbit-local-cron-secret'
```

Owners and administrators receive project-overdue alerts. Owners, administrators, and the task assignee receive task-overdue alerts. Each recipient/entity combination is deduplicated, so repeatedly running the scan does not repeatedly email the same alert. Alerts appear both in Mailpit and the application's Inbox.

In production, schedule this endpoint daily and use a newly generated `CRON_SECRET`. Schedule `/api/mail/process` every minute for Mailgun delivery retries.
