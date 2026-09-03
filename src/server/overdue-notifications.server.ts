import { getServerConfig } from "@/lib/config.server";
import { getPool } from "./db/client.server";
import { sendTransactionalEmail } from "./mail/mailgun.server";

export async function processOverdueNotifications() {
  const pool = getPool(); const appUrl = getServerConfig().appUrl; let created = 0;
  const projects = await pool.query(`SELECT p.id,p.name,p.key,p.organization_id FROM projects p WHERE p.end_date < CURRENT_DATE AND p.status NOT IN ('completed','archived') AND p.archived_at IS NULL`);
  for (const project of projects.rows) {
    const recipients = await pool.query(`SELECT DISTINCT om.user_id,COALESCE(pr.email,u.email) email FROM organization_members om JOIN "user" u ON u.id=om.user_id LEFT JOIN profiles pr ON pr.id=om.user_id WHERE om.organization_id=$1 AND om.role IN ('owner','admin')`, [project.organization_id]);
    for (const recipient of recipients.rows) {
      const inserted = await pool.query(`INSERT INTO system_notifications(user_id,kind,title,body,href,dedupe_key) VALUES($1,'project-overdue',$2,$3,$4,$5) ON CONFLICT(user_id,dedupe_key) DO NOTHING RETURNING id`, [recipient.user_id, `Project overdue: ${project.name}`, `${project.key} has passed its end date.`, `/app/projects/${project.key}`, `project-overdue:${project.id}`]);
      if (inserted.rowCount) { created++; await sendTransactionalEmail({ kind: "project-overdue", to: recipient.email, subject: `Project overdue: ${project.name}`, text: `${project.key} has passed its end date. Review it: ${appUrl}/app/projects/${project.key}` }); }
    }
  }
  const tasks = await pool.query(`SELECT t.id,t.title,t.number,t.assignee_id,p.key,p.organization_id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.due_date < now() AND t.status NOT IN ('done','cancelled')`);
  for (const task of tasks.rows) {
    const recipients = await pool.query(`SELECT DISTINCT om.user_id,COALESCE(pr.email,u.email) email FROM organization_members om JOIN "user" u ON u.id=om.user_id LEFT JOIN profiles pr ON pr.id=om.user_id WHERE om.organization_id=$1 AND (om.role IN ('owner','admin') OR om.user_id=$2)`, [task.organization_id, task.assignee_id]);
    for (const recipient of recipients.rows) {
      const inserted = await pool.query(`INSERT INTO system_notifications(user_id,kind,title,body,href,dedupe_key) VALUES($1,'task-overdue',$2,$3,$4,$5) ON CONFLICT(user_id,dedupe_key) DO NOTHING RETURNING id`, [recipient.user_id, `Task overdue: ${task.key}-${task.number}`, task.title, `/app/projects/${task.key}`, `task-overdue:${task.id}`]);
      if (inserted.rowCount) { created++; await sendTransactionalEmail({ kind: "task-overdue", to: recipient.email, subject: `Task overdue: ${task.key}-${task.number}`, text: `${task.title} is overdue. Review it: ${appUrl}/app/projects/${task.key}` }); }
    }
  }
  return { projects: projects.rowCount, tasks: tasks.rowCount, notificationsCreated: created };
}
