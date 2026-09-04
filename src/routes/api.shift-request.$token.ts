import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@/server/auth.server";
import { getPool } from "@/server/db/client.server";
import { notifyShiftSwapAccepted } from "@/server/shift-swap-notifications.server";

export const Route = createFileRoute("/api/shift-request/$token")({ server: { handlers: {
  GET: async ({ params }) => {
    const result = await getPool().query(`SELECT r.id,r.kind,r.reason,r.status,r.expires_at,r.preferred_start_at,r.preferred_end_at,s.start_at,s.end_at,st.label AS shift_type,COALESCE(p.full_name,u.name,u.email) AS requester_name FROM shift_swap_requests r JOIN shifts s ON s.id=r.from_shift_id LEFT JOIN shift_types st ON st.id=s.shift_type_id LEFT JOIN profiles p ON p.id=r.from_user_id LEFT JOIN "user" u ON u.id=r.from_user_id WHERE r.action_token=$1`, [params.token]);
    return result.rows[0] ? Response.json({ request: result.rows[0] }) : Response.json({ error: "Shift request not found" }, { status: 404 });
  },
  POST: async ({ request, params }) => {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session?.user) return Response.json({ error: "Please sign in first" }, { status: 401 });
    if (!session.user.emailVerified) return Response.json({ error: "Verify your email before responding" }, { status: 403 });
    const { action, assigneeId } = await request.json() as { action: "accept" | "decline"; assigneeId?: string };
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.jwt',$2,true)", [session.user.id, JSON.stringify({ sub: session.user.id, email: session.user.email })]);
      await client.query("SET LOCAL ROLE authenticated");
      const found = await client.query("SELECT * FROM shift_swap_requests WHERE action_token=$1 FOR UPDATE", [params.token]);
      const row = found.rows[0];
      if (!row || !["pending", "approved"].includes(row.status) || (row.expires_at && new Date(row.expires_at) < new Date())) throw new Error("This request is no longer active");
      if (action === "accept") await client.query("SELECT public.apply_shift_swap($1,$2)", [row.id, assigneeId ?? null]);
      else if (action === "decline" && row.kind !== "open") await client.query("UPDATE shift_swap_requests SET status='declined',decided_by=$1,decided_at=now() WHERE id=$2", [session.user.id, row.id]);
      else throw new Error("Invalid action");
      await client.query("COMMIT");
      if (action === "accept") await notifyShiftSwapAccepted(row.id).catch((error) => console.error("Unable to notify shift requester", error));
      return Response.json({ ok: true, action });
    } catch (error) { await client.query("ROLLBACK"); return Response.json({ error: error instanceof Error ? error.message : "Unable to respond" }, { status: 400 }); }
    finally { client.release(); }
  },
} } });
