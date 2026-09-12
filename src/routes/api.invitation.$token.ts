import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@/server/auth.server";
import { getPool } from "@/server/db/client.server";

export const Route = createFileRoute("/api/invitation/$token")({ server: { handlers: {
  GET: async ({ params }) => {
    const result = await getPool().query(`SELECT i.id,i.email,i.role,i.team_id,t.name AS team_name,i.expires_at,i.accepted_at,i.declined_at,i.revoked_at,COALESCE(r.name, initcap(i.role::text)) AS role_name,o.name AS organization_name,EXISTS(SELECT 1 FROM "user" u WHERE lower(u.email)=lower(i.email)) AS has_account FROM invitations i JOIN organizations o ON o.id=i.organization_id LEFT JOIN custom_roles r ON r.id=i.custom_role_id LEFT JOIN teams t ON t.id=i.team_id AND t.organization_id=i.organization_id WHERE i.token=$1`, [params.token]);
    return result.rows[0] ? Response.json({ invite: result.rows[0] }) : Response.json({ error: "Invitation not found" }, { status: 404 });
  },
  POST: async ({ request, params }) => {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session?.user) return Response.json({ error: "Please sign in first" }, { status: 401 });
    if (!session.user.emailVerified) return Response.json({ error: "Verify your email before responding" }, { status: 403 });
    const { action } = await request.json() as { action: "accept" | "decline" };
    if (!["accept", "decline"].includes(action)) return Response.json({ error: "Invalid action" }, { status: 400 });
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const found = await client.query("SELECT * FROM invitations WHERE token=$1 FOR UPDATE", [params.token]);
      const invite = found.rows[0];
      if (!invite || invite.accepted_at || invite.declined_at || invite.revoked_at || new Date(invite.expires_at) < new Date()) throw new Error("This invitation is no longer active");
      if (invite.email.toLowerCase() !== session.user.email.toLowerCase()) throw new Error(`This invitation belongs to ${invite.email}`);
      if (action === "accept") {
        await client.query("INSERT INTO organization_members (organization_id,user_id,role,custom_role_id,can_access_projects,can_access_shifts,invited_by) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (organization_id,user_id) DO NOTHING", [invite.organization_id, session.user.id, invite.role, invite.custom_role_id, invite.can_access_projects, invite.can_access_shifts, invite.invited_by]);
        if (invite.team_id) {
          const team = await client.query("SELECT id FROM teams WHERE id=$1 AND organization_id=$2 FOR KEY SHARE", [invite.team_id, invite.organization_id]);
          if (!team.rowCount) throw new Error("This team is no longer available");
          await client.query("INSERT INTO team_members (team_id,user_id,role) VALUES ($1,$2,'member') ON CONFLICT (team_id,user_id) DO NOTHING", [invite.team_id, session.user.id]);
        }
        await client.query("UPDATE invitations SET accepted_at=now() WHERE id=$1", [invite.id]);
      } else await client.query("UPDATE invitations SET declined_at=now() WHERE id=$1", [invite.id]);
      await client.query("COMMIT");
      return Response.json({ ok: true, action, organizationId: invite.organization_id, teamId: invite.team_id });
    } catch (error) { await client.query("ROLLBACK"); return Response.json({ error: error instanceof Error ? error.message : "Unable to respond" }, { status: 400 }); }
    finally { client.release(); }
  },
} } });
