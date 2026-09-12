import { z } from "zod";
import { getAuth } from "./auth.server";
import { getPool } from "./db/client.server";
import { getServerConfig } from "@/lib/config.server";
import { sendTransactionalEmail } from "./mail/mailgun.server";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invite"), teamId: z.uuid(), email: z.email().max(254).transform((email) => email.toLowerCase()) }),
  z.object({ action: z.literal("add"), teamId: z.uuid(), userId: z.uuid() }),
  z.object({ action: z.enum(["resend", "cancel"]), teamId: z.uuid(), invitationId: z.uuid() }),
]);

export async function handleTeamInvitations(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user) return Response.json({ error: "Please sign in first" }, { status: 401 });
  if (!session.user.emailVerified) return Response.json({ error: "Verify your email first" }, { status: 403 });
  const isRead = request.method === "GET";
  const input = isRead ? null : inputSchema.safeParse(await request.json().catch(() => null));
  if (input && !input.success) return Response.json({ error: "Enter a valid email and team invitation details" }, { status: 400 });
  const command = input?.success ? input.data : null;
  const teamId = command?.teamId ?? new URL(request.url).searchParams.get("teamId");
  if (!z.uuid().safeParse(teamId).success) return Response.json({ error: "Invalid team" }, { status: 400 });
  const client = await getPool().connect();
  let emailInvitation: { email: string; token: string } | undefined;
  let teamName = "";
  let organizationName = "";
  let outcome = "invited";
  try {
    await client.query("BEGIN");
    // Serialize invitation changes for a team, including concurrent sends and resends.
    const context = await client.query(
      `SELECT t.name,t.organization_id,o.name AS organization_name,m.role,m.can_access_projects,m.can_access_shifts,
              public.has_permission(t.organization_id,$2,'members.invite') AS can_invite
       FROM teams t JOIN organizations o ON o.id=t.organization_id
       JOIN organization_members m ON m.organization_id=t.organization_id AND m.user_id=$2
       WHERE t.id=$1 AND m.role IN ('owner','admin','manager') FOR UPDATE OF t`,
      [teamId, session.user.id],
    );
    const team = context.rows[0];
    if (!team || (command?.action !== "add" && !team.can_invite)) {
      await client.query("ROLLBACK");
      return Response.json({ error: "You do not have permission to manage these team invitations" }, { status: 403 });
    }
    teamName = team.name;
    organizationName = team.organization_name;
    if (isRead) {
      const invitations = await client.query(
        `SELECT id,email,expires_at,created_at FROM invitations WHERE team_id=$1
         AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC`, [teamId],
      );
      await client.query("COMMIT");
      return Response.json({ invitations: invitations.rows });
    }
    if (!command) throw new Error("Invalid invitation action");
    if (command.action === "add" || command.action === "invite") {
      const existing = await client.query(
        `SELECT m.user_id FROM organization_members m JOIN "user" u ON u.id=m.user_id
         WHERE m.organization_id=$1 AND ${command.action === "add" ? "m.user_id=$2::uuid" : "lower(u.email)=$2"}`,
        [team.organization_id, command.action === "add" ? command.userId : command.email],
      );
      if (existing.rowCount) {
        await client.query("INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT(team_id,user_id) DO NOTHING", [teamId, existing.rows[0].user_id]);
        // An earlier email invitation is no longer needed after direct addition.
        await client.query(`UPDATE invitations SET revoked_at=now() WHERE team_id=$1
          AND lower(email)=(SELECT lower(email) FROM "user" WHERE id=$2)
          AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL`, [teamId, existing.rows[0].user_id]);
        outcome = "added";
      } else if (command.action === "add") {
        throw new Error("Choose a member of this workspace");
      } else {
        const pending = await client.query(`SELECT id FROM invitations WHERE team_id=$1 AND lower(email)=$2
          AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL AND expires_at>now()`, [teamId, command.email]);
        if (pending.rowCount) throw new Error("This person already has a pending invitation. Use Resend below.");
        await client.query(`UPDATE invitations SET revoked_at=now() WHERE team_id=$1 AND lower(email)=$2
          AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL`, [teamId, command.email]);
        const elevated = ["owner", "admin"].includes(team.role);
        const created = await client.query(
          `INSERT INTO invitations(organization_id,team_id,email,role,invited_by,can_access_projects,can_access_shifts)
           VALUES($1,$2,$3,'member',$4,$5,$6) RETURNING email,token`,
          [team.organization_id, teamId, command.email, session.user.id, elevated || team.can_access_projects, elevated || team.can_access_shifts],
        );
        emailInvitation = created.rows[0];
      }
    } else {
      const found = await client.query(`SELECT * FROM invitations WHERE id=$1 AND team_id=$2 FOR UPDATE`, [command.invitationId, teamId]);
      const invitation = found.rows[0];
      if (!invitation || invitation.accepted_at || invitation.declined_at || invitation.revoked_at) throw new Error("This invitation is no longer pending");
      if (command.action === "cancel") {
        await client.query("UPDATE invitations SET revoked_at=now() WHERE id=$1", [invitation.id]);
        outcome = "cancelled";
      } else {
        const elevated = ["owner", "admin"].includes(team.role);
        if (!elevated && (!['member', 'viewer'].includes(invitation.role) || invitation.custom_role_id)) {
          throw new Error("Ask a workspace admin to resend this invitation");
        }
        const updated = await client.query(`UPDATE invitations SET token=encode(gen_random_bytes(24),'hex'),
          expires_at=now()+interval '7 days',invited_by=$2,
          can_access_projects=$3,can_access_shifts=$4 WHERE id=$1 RETURNING email,token`,
          [invitation.id, session.user.id, elevated || team.can_access_projects, elevated || team.can_access_shifts]);
        emailInvitation = updated.rows[0];
        outcome = "resent";
      }
    }
    await client.query(`INSERT INTO audit_events(user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,'teams',$3,$4)`,
      [session.user.id, `team-member-${outcome}`, teamId, JSON.stringify({ action: command.action })]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Team invitation operation failed", error);
    const message = error instanceof Error && !('code' in error) ? error.message : "Unable to update the team invitation";
    return Response.json({ error: message }, { status: 400 });
  } finally {
    client.release();
  }
  let warning: string | undefined;
  if (emailInvitation) {
    try {
      const url = `${getServerConfig().appUrl}/accept-invite/${emailInvitation.token}`;
      const delivery = await sendTransactionalEmail({
        kind: "team-invitation", to: emailInvitation.email,
        subject: `${session.user.name || "A team manager"} invited you to ${teamName} in ${organizationName}`,
        text: `You have been invited to join the ${teamName} team in ${organizationName}. Accepting joins you to the workspace as a member if you are not already a member. Your existing workspace role will be preserved. This invitation expires in seven days. Review your invitation: ${url}`,
      });
      if (delivery.mode === "suppressed") warning = "Invitation saved, but email delivery is disabled for this address.";
    } catch {
      warning = "Invitation saved, but the email could not be queued. Please use Resend to try again.";
    }
  }
  return Response.json({ ok: true, outcome, warning });
}
