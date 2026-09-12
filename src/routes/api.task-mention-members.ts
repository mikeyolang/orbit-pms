import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getAuth } from "@/server/auth.server";
import { getPool } from "@/server/db/client.server";

export const Route = createFileRoute("/api/task-mention-members")({ server: { handlers: { GET: async ({ request }) => {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user) return Response.json({ error: "Please sign in first" }, { status: 401 });
  const taskId = new URL(request.url).searchParams.get("taskId");
  if (!z.uuid().safeParse(taskId).success) return Response.json({ error: "Invalid task" }, { status: 400 });
  const pool = getPool();
  const task = await pool.query(`SELECT project_id FROM tasks WHERE id=$1 AND public.can_access_project(project_id,$2)`, [taskId, session.user.id]);
  if (!task.rowCount) return Response.json({ error: "Task not available" }, { status: 404 });
  const members = await pool.query(`SELECT u.id AS user_id,COALESCE(NULLIF(pr.full_name,''),NULLIF(u.name,''),u.email) AS name,u.email
    FROM projects p JOIN organization_members m ON m.organization_id=p.organization_id
    JOIN "user" u ON u.id=m.user_id LEFT JOIN profiles pr ON pr.id=u.id
    WHERE p.id=$1 AND public.can_access_project(p.id,u.id)
    ORDER BY lower(COALESCE(NULLIF(pr.full_name,''),NULLIF(u.name,''),u.email)),u.id`, [task.rows[0].project_id]);
  return Response.json({ members: members.rows });
} } } });
