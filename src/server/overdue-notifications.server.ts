import { getServerConfig } from "@/lib/config.server";
import { getPool } from "./db/client.server";

// Save the Inbox alert and email together. The mail worker delivers/retries the outbox.
async function queueAlert(recipient: { user_id: string; email: string }, kind: string, title: string, body: string, href: string, dedupeKey: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(`INSERT INTO system_notifications(user_id,kind,title,body,href,dedupe_key)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,dedupe_key) DO NOTHING RETURNING id`,
      [recipient.user_id, kind, title, body, href, dedupeKey]);
    if (inserted.rowCount && recipient.email) {
      await client.query(`INSERT INTO mail_outbox(kind,recipient,subject,text_body)
        SELECT $1,lower($2),$3,$4 WHERE NOT EXISTS(SELECT 1 FROM mail_suppressions WHERE recipient=lower($2))`,
        [kind, recipient.email, title, `${body}\n\nView details: ${getServerConfig().appUrl}${href}`]);
    }
    await client.query("COMMIT");
    return inserted.rowCount ?? 0;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function processOverdueNotifications() {
  const pool = getPool();
  let created = 0;
  const projects = await pool.query(`SELECT p.id,p.name,p.key,p.organization_id,p.end_date FROM projects p
    WHERE p.end_date < CURRENT_DATE AND p.status NOT IN ('completed','archived') AND p.archived_at IS NULL`);
  for (const project of projects.rows) {
    const recipients = await pool.query(`SELECT om.user_id,u.email FROM organization_members om JOIN "user" u ON u.id=om.user_id
      WHERE om.organization_id=$1 AND om.role IN ('owner','admin') AND public.can_access_project($2,om.user_id)`, [project.organization_id, project.id]);
    for (const recipient of recipients.rows) {
      created += await queueAlert(recipient, "project-overdue", `Project overdue: ${project.name}`, `${project.key} has passed its end date.`,
        `/app/projects/${encodeURIComponent(project.key)}`, `project-overdue:${project.id}:${new Date(project.end_date).toISOString()}`);
    }
  }
  const tasks = await pool.query(`SELECT t.id,t.title,t.number,t.assignee_id,t.project_id,t.status,t.due_date,t.updated_at,
      p.key,p.organization_id,COALESCE(NULLIF(u.name,''),u.email,'Unassigned') AS assignee_name,
      t.due_date <= now() AS overdue,
      (SELECT count(*) FROM tasks child WHERE child.parent_task_id=t.id AND child.status<>'cancelled') AS subtask_total,
      (SELECT count(*) FROM tasks child WHERE child.parent_task_id=t.id AND child.status='done') AS subtask_done
    FROM tasks t JOIN projects p ON p.id=t.project_id LEFT JOIN "user" u ON u.id=t.assignee_id
    WHERE t.due_date <= now()+interval '24 hours' AND t.status NOT IN ('done','cancelled')
      AND p.archived_at IS NULL AND p.status NOT IN ('completed','archived')`);
  let dueSoon = 0;
  let overdue = 0;
  for (const task of tasks.rows) {
    if (task.overdue) overdue++; else dueSoon++;
    const kind = task.overdue ? "task-overdue" : "task-due-soon";
    const reference = `${task.key}-${task.number}`;
    const due = new Date(task.due_date).toISOString();
    const subtaskProgress = Number(task.subtask_total) ? ` Subtasks: ${task.subtask_done}/${task.subtask_total} completed.` : "";
    const summary = `${task.title}\nStatus: ${String(task.status).replaceAll('_', ' ')}. Assignee: ${task.assignee_name}. Due: ${due} (UTC).${subtaskProgress}\nLast updated: ${new Date(task.updated_at).toISOString()}.`;
    const recipients = await pool.query(`SELECT om.user_id,u.email FROM organization_members om JOIN "user" u ON u.id=om.user_id
      WHERE om.organization_id=$1 AND (om.role IN ('owner','admin') OR ($3::boolean AND om.user_id=$2))
      AND public.can_access_project($4,om.user_id)`, [task.organization_id, task.assignee_id, task.overdue, task.project_id]);
    for (const recipient of recipients.rows) {
      created += await queueAlert(recipient, kind, `${task.overdue ? "Task overdue" : "Task due within 24 hours"}: ${reference}`, summary,
        `/app/projects/${encodeURIComponent(task.key)}?task=${encodeURIComponent(task.id)}`, `${kind}:${task.id}:${due}`);
    }
  }
  return { projects: projects.rowCount, tasks: tasks.rowCount, dueSoon, overdue, notificationsCreated: created };
}
