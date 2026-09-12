import { queueTaskMentionEmails } from "./task-mention-email.server";
import { getAuth } from "./auth.server";
import { getPool } from "./db/client.server";
import { getServerConfig } from "@/lib/config.server";
import { escapeEmailHtml, sendTransactionalEmail, processMailOutbox } from "./mail/mailgun.server";
import { notifyShiftSwapAccepted } from "./shift-swap-notifications.server";

const TABLES = new Set([
  "bus_companies", "custom_role_permissions", "custom_roles", "invitations", "join_requests", "labels", "member_permissions", "milestones",
  "organization_members", "organizations", "profiles", "projects", "role_permissions",
  "shift_absences", "shift_coverage_offers", "shift_settings", "shift_swap_requests", "shift_types", "shifts", "sprints",
  "shift_report_companies", "shift_reports", "task_activity", "task_comments", "task_dependencies", "task_labels", "tasks",
  "team_members", "teams", "system_notifications",
]);
const FUNCTIONS = new Set([
  "apply_shift_swap", "decide_join_request", "my_join_requests", "my_pending_invites",
  "my_permissions", "request_or_join_by_code",
  "decide_task_approval",
  "approve_coverage_offer",
  "latest_shift_handover",
]);
const identifier = /^[a-z_][a-z0-9_]*$/;

type Filter = { kind: "eq" | "neq" | "in" | "or" | "gt" | "gte" | "lt" | "lte"; column?: string; value: unknown };
type DataRequest = {
  operation: "select" | "insert" | "update" | "delete" | "upsert" | "rpc";
  table?: string;
  fn?: string;
  values?: Record<string, unknown> | Record<string, unknown>[];
  filters?: Filter[];
  orders?: { column: string; ascending?: boolean; nullsFirst?: boolean }[];
  limit?: number;
  single?: boolean;
  maybeSingle?: boolean;
  params?: Record<string, unknown>;
  onConflict?: string;
};

function quoted(name: string) {
  if (!identifier.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return `"${name}"`;
}

function filtersSql(filters: Filter[] = [], values: unknown[]) {
  const parts: string[] = [];
  for (const filter of filters) {
    if (filter.kind === "or") {
      const clauses = String(filter.value).split(",").map((part) => {
        const match = part.match(/^([a-z_][a-z0-9_]*)\.(eq|neq)\.(.*)$/);
        if (!match) throw new Error("Unsupported OR filter");
        values.push(match[3]);
        return `${quoted(match[1])} ${match[2] === "eq" ? "=" : "<>"} $${values.length}`;
      });
      parts.push(`(${clauses.join(" OR ")})`);
      continue;
    }
    if (!filter.column) throw new Error("Filter column is required");
    const column = quoted(filter.column);
    if (filter.kind === "in") {
      const list = Array.isArray(filter.value) ? filter.value : [];
      if (!list.length) { parts.push("FALSE"); continue; }
      const slots = list.map((item) => { values.push(item); return `$${values.length}`; });
      parts.push(`${column} IN (${slots.join(",")})`);
    } else if (filter.value === null) {
      parts.push(`${column} IS ${filter.kind === "neq" ? "NOT " : ""}NULL`);
    } else {
      values.push(filter.value);
      const operator = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[filter.kind];
      parts.push(`${column} ${operator} $${values.length}`);
    }
  }
  return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
}

function databaseValue(table: string, column: string, value: unknown) {
  // pg treats JavaScript arrays as PostgreSQL arrays, not JSON. Accept either
  // structured mentions or an already serialized JSON value without double encoding.
  if (table === "task_comments" && column === "mentions") {
    return typeof value === "string" ? value : JSON.stringify(value ?? []);
  }
  return value ?? null;
}

function mutationSql(operation: DataRequest["operation"], table: string, body: DataRequest, params: unknown[]) {
  const rows = Array.isArray(body.values) ? body.values : [body.values ?? {}];
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  columns.forEach(quoted);
  if (operation === "insert" || operation === "upsert") {
    const tuples = rows.map((row) => `(${columns.map((column) => {
      params.push(databaseValue(table, column, row[column])); return `$${params.length}`;
    }).join(",")})`);
    const conflictColumns = body.onConflict?.split(",").map((column) => quoted(column.trim())).join(",");
    if (operation === "upsert" && !conflictColumns) throw new Error("Upsert conflict columns are required");
    const conflict = operation === "upsert" ? ` ON CONFLICT (${conflictColumns}) DO UPDATE SET ` + columns.map((c) => `${quoted(c)} = EXCLUDED.${quoted(c)}`).join(",") : "";
    return `INSERT INTO public.${quoted(table)} (${columns.map(quoted).join(",")}) VALUES ${tuples.join(",")}${conflict} RETURNING *`;
  }
  if (operation === "update") {
    const row = rows[0];
    const sets = columns.map((column) => { params.push(databaseValue(table, column, row[column])); return `${quoted(column)} = $${params.length}`; });
    return `UPDATE public.${quoted(table)} SET ${sets.join(",")}${filtersSql(body.filters, params)} RETURNING *`;
  }
  return `DELETE FROM public.${quoted(table)}${filtersSql(body.filters, params)} RETURNING *`;
}

async function enrichRows(client: any, table: string, rows: any[]) {
  if (!rows.length) return rows;
  const link = async (key: string, target: string, targetKey: string, alias: string) => {
    const ids = [...new Set(rows.map((row) => row[key]).filter(Boolean))];
    if (!ids.length) return;
    const result = await client.query(`SELECT * FROM public.${quoted(target)} WHERE ${quoted(targetKey)} = ANY($1)`, [ids]);
    const byId = new Map(result.rows.map((row: any) => [row[targetKey], row]));
    rows.forEach((row) => { row[alias] = byId.get(row[key]) ?? null; });
  };
  if (table === "invitations") await link("organization_id", "organizations", "id", "organization");
  if (["tasks", "task_activity", "task_comments"].includes(table)) {
    if (table === "tasks") await link("project_id", "projects", "id", "project");
    else {
      await link("task_id", "tasks", "id", "task");
      const projectIds = [...new Set(rows.map((row) => row.task?.project_id).filter(Boolean))];
      if (projectIds.length) {
        const projects = await client.query("SELECT * FROM public.projects WHERE id = ANY($1)", [projectIds]);
        const byId = new Map(projects.rows.map((project: any) => [project.id, project]));
        rows.forEach((row) => { if (row.task) row.task.project = byId.get(row.task.project_id) ?? null; });
      }
    }
  }
  if (table === "organization_members") {
    await link("user_id", "profiles", "id", "profile");
    const missingProfileIds = [...new Set(rows.filter((row) => !row.profile).map((row) => row.user_id).filter(Boolean))];
    if (missingProfileIds.length) {
      const users = await client.query(`SELECT id, name AS full_name, email FROM public."user" WHERE id = ANY($1)`, [missingProfileIds]);
      const byId = new Map(users.rows.map((user: any) => [user.id, user]));
      rows.forEach((row) => { if (!row.profile) row.profile = byId.get(row.user_id) ?? null; });
    }
    await link("organization_id", "organizations", "id", "organization");
  }
  if (table === "task_dependencies") await link("depends_on_task_id", "tasks", "id", "depends_on");
  if (table === "shifts") await link("shift_type_id", "shift_types", "id", "shift_type");
  if (table === "shift_swap_requests") {
    await link("from_shift_id", "shifts", "id", "from_shift");
    const typeIds = [...new Set(rows.map((row) => row.from_shift?.shift_type_id).filter(Boolean))];
    if (typeIds.length) {
      const types = await client.query("SELECT * FROM public.shift_types WHERE id = ANY($1)", [typeIds]);
      const byId = new Map(types.rows.map((type: any) => [type.id, type]));
      rows.forEach((row) => { if (row.from_shift) row.from_shift.shift_type = byId.get(row.from_shift.shift_type_id) ?? null; });
    }
  }
  return rows;
}

export async function handleDataRequest(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user) return Response.json({ data: null, error: { message: "Unauthorized" } }, { status: 401 });
  let body: DataRequest;
  try { body = await request.json(); } catch { return Response.json({ data: null, error: { message: "Invalid JSON" } }, { status: 400 }); }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.jwt', $2, true)", [session.user.id, JSON.stringify({ sub: session.user.id, email: session.user.email })]);
    await client.query("SET LOCAL ROLE authenticated");
    let result;
    const previousAssignees = new Map<string, string | null>();
    if (body.table === "tasks" && body.operation === "update") {
      const previousParams: unknown[] = [];
      const previous = await client.query(`SELECT id,assignee_id FROM tasks${filtersSql(body.filters, previousParams)} FOR UPDATE`, previousParams);
      for (const task of previous.rows) previousAssignees.set(task.id, task.assignee_id);
    }
    if (body.operation === "rpc") {
      if (!body.fn || !FUNCTIONS.has(body.fn)) throw new Error("Function is not allowed");
      const entries = Object.entries(body.params ?? {});
      result = await client.query(`SELECT * FROM public.${quoted(body.fn)}(${entries.map(([key], i) => `${quoted(key)} => $${i + 1}`).join(",")})`, entries.map(([, value]) => value));
    } else {
      if (!body.table || !TABLES.has(body.table)) throw new Error("Table is not allowed");
      const params: unknown[] = [];
      if (body.operation === "select") {
        let sql = `SELECT * FROM public.${quoted(body.table)}${filtersSql(body.filters, params)}`;
        if (body.orders?.length) sql += " ORDER BY " + body.orders.map((o) => `${quoted(o.column)} ${o.ascending === false ? "DESC" : "ASC"}${o.nullsFirst === true ? " NULLS FIRST" : o.nullsFirst === false ? " NULLS LAST" : ""}`).join(",");
        if (body.limit) { params.push(Math.max(1, Math.min(500, body.limit))); sql += ` LIMIT $${params.length}`; }
        result = await client.query(sql, params);
      } else result = await client.query(mutationSql(body.operation, body.table, body, params), params);
      result.rows = await enrichRows(client, body.table, result.rows);
      if (body.table === "tasks" && ["insert", "update", "upsert"].includes(body.operation)) {
        for (const row of result.rows) if (row.assignee_id) {
          const eligible = await client.query(
            `SELECT 1 FROM projects p JOIN organization_members m ON m.organization_id=p.organization_id AND m.user_id=$2
             WHERE p.id=$1 AND (m.can_access_projects=true OR m.role IN ('owner','admin'))`,
            [row.project_id, row.assignee_id],
          );
          if (!eligible.rowCount) throw new Error("Tasks can only be assigned to members with Projects access");
        }
        const changedValues = Array.isArray(body.values) ? body.values[0] : body.values ?? {};
        if (body.operation === "update" && Object.prototype.hasOwnProperty.call(changedValues, "priority")) {
          const projectIds = [...new Set(result.rows.map((row) => row.project_id).filter(Boolean))];
          const permitted = await client.query(
            `SELECT DISTINCT p.id
             FROM projects p
             JOIN organization_members m ON m.organization_id=p.organization_id
             WHERE p.id = ANY($1::uuid[]) AND m.user_id=$2 AND m.role IN ('owner','admin')`,
            [projectIds, session.user.id],
          );
          if (permitted.rowCount !== projectIds.length) throw new Error("Only workspace admins can change task priority after creation");
        }
      }
    }
    if (body.table === "task_comments" && body.operation === "insert") {
      // The comment mutation above ran under the caller's row-level permissions.
      // Queue server-owned mail in the same transaction as the saved message.
      await client.query("RESET ROLE");
      await queueTaskMentionEmails(client, result.rows.map((row) => String(row.id)));
    }
    await client.query("COMMIT");
    if (body.table === "task_comments" && body.operation === "insert" && ["smtp", "log"].includes(getServerConfig().mailMode)) {
      await processMailOutbox(20).catch((error) => console.error("Mention email delivery deferred to mail worker", error));
    }
    if (body.operation === "rpc" && body.fn === "apply_shift_swap" && typeof body.params?._request_id === "string") {
      await notifyShiftSwapAccepted(body.params._request_id).catch((error) => console.error("Unable to notify shift requester", error));
    }
    if (!["select", "rpc"].includes(body.operation)) {
      const resourceId = result.rows[0]?.id ? String(result.rows[0].id) : null;
      await getPool().query("INSERT INTO public.audit_events (user_id, action, resource_type, resource_id, metadata) VALUES ($1,$2,$3,$4,$5)", [session.user.id, body.operation, body.table, resourceId, JSON.stringify({ rowCount: result.rowCount })]);
    }
    try {
      const row = result.rows[0];
      if (body.table === "invitations" && body.operation === "insert" && row?.email) {
        const url = `${getServerConfig().appUrl}/accept-invite/${row.token}`;
        const organization = await getPool().query("SELECT name FROM organizations WHERE id=$1", [row.organization_id]);
        const organizationName = organization.rows[0]?.name ?? "a Voltic PMS workspace";
        const team = row.team_id ? await getPool().query("SELECT name FROM teams WHERE id=$1 AND organization_id=$2", [row.team_id, row.organization_id]) : null;
        const destinationName = team?.rows[0]?.name ? `${team.rows[0].name} in ${organizationName}` : organizationName;
        const inviter = await getPool().query(`SELECT COALESCE(NULLIF(p.full_name,''),NULLIF(u.name,''),u.email) AS name FROM "user" u LEFT JOIN profiles p ON p.id=u.id WHERE u.id=$1`, [row.invited_by]);
        const inviterName = inviter.rows[0]?.name ?? session.user.name ?? session.user.email;
        const customRole = row.custom_role_id ? await getPool().query("SELECT name FROM custom_roles WHERE id=$1", [row.custom_role_id]) : null;
        const roleName = customRole?.rows[0]?.name ?? row.role;
        await sendTransactionalEmail({
          kind: "organization-invitation",
          to: row.email,
          subject: `${inviterName} invited you to ${destinationName}`,
          text: `${inviterName} invited you to join ${destinationName} as ${roleName}. Review your invitation: ${url}`,
          html: `<p><strong>${escapeEmailHtml(inviterName)}</strong> invited you to join <strong>${escapeEmailHtml(destinationName)}</strong>.</p><p>Your role will be <strong>${escapeEmailHtml(roleName)}</strong>.</p><p><a href="${url}">Review invitation</a></p>`,
        });
      }
      for (const row of result.rows) {
      if (body.table === "tasks" && ["insert", "update"].includes(body.operation) && row?.assignee_id && (body.operation === "insert" || previousAssignees.get(row.id) !== row.assignee_id)) {
        const context = await getPool().query(
          `SELECT p.key,p.name AS project_name,COALESCE(NULLIF(pr.email,''),u.email) AS email
           FROM projects p
           JOIN "user" u ON u.id=$2
           LEFT JOIN profiles pr ON pr.id=u.id
           WHERE p.id=$1`,
          [row.project_id, row.assignee_id],
        );
        const assignment = context.rows[0];
        if (assignment) {
          const taskRef = `${assignment.key}-${row.number}`;
          const href = `/app/projects/${encodeURIComponent(assignment.key)}?task=${encodeURIComponent(row.id)}`;
          const url = `${getServerConfig().appUrl}${href}`;
          const dedupeVersion = row.updated_at ?? row.created_at ?? new Date().toISOString();
          const notice = await getPool().query(
            `INSERT INTO system_notifications(user_id,kind,title,body,href,dedupe_key)
             VALUES($1,'task-assignment',$2,$3,$4,$5)
             ON CONFLICT(user_id,dedupe_key) DO NOTHING RETURNING id`,
            [
              row.assignee_id,
              `Task assigned: ${taskRef}`,
              row.title,
              href,
              `task-assignment:${row.id}:${row.assignee_id}:${dedupeVersion}`,
            ],
          );
          if (notice.rowCount && assignment.email) {
            await sendTransactionalEmail({
              kind: "task-assignment",
              to: assignment.email,
              subject: `You were assigned ${taskRef}`,
              text: `You have been assigned a task in ${assignment.project_name}.\n\n${taskRef}: ${row.title}\n\nView task: ${url}`,
              html: `<p>You have been assigned a task in <strong>${escapeEmailHtml(assignment.project_name)}</strong>.</p><p><strong>${escapeEmailHtml(taskRef)}</strong><br>${escapeEmailHtml(row.title)}</p><p><a href="${escapeEmailHtml(url)}">View task</a></p>`,
            });
          }
        }
      }
      }
      if (body.table === "tasks" && body.operation === "update" && row?.status === "done" && (Array.isArray(body.values) ? body.values[0] : body.values ?? {}).status === "done") {
        const context = await getPool().query(
          `SELECT p.key,p.name AS project_name
           FROM projects p
           WHERE p.id=$1`,
          [row.project_id],
        );
        const project = context.rows[0];
        if (project) {
          const taskRef = `${project.key}-${row.number}`;
          const href = `/app/projects/${encodeURIComponent(project.key)}?task=${encodeURIComponent(row.id)}`;
          const url = `${getServerConfig().appUrl}${href}`;
          const recipientIds = [...new Set([row.reporter_id, row.created_by].filter((id): id is string => Boolean(id && id !== session.user.id)))];
          if (recipientIds.length) {
            const recipients = await getPool().query(
              `SELECT u.id,COALESCE(NULLIF(pr.email,''),u.email) AS email
               FROM "user" u
               LEFT JOIN profiles pr ON pr.id=u.id
               WHERE u.id = ANY($1::uuid[])`,
              [recipientIds],
            );
            for (const recipient of recipients.rows) {
              const inserted = await getPool().query(
                `INSERT INTO system_notifications(user_id,kind,title,body,href,dedupe_key)
                 VALUES($1,'task-completed',$2,$3,$4,$5)
                 ON CONFLICT(user_id,dedupe_key) DO NOTHING
                 RETURNING id`,
                [recipient.id, `Task completed: ${taskRef}`, row.title, href, `task-completed:${row.id}`],
              );
              if (inserted.rowCount && recipient.email) {
                await sendTransactionalEmail({
                  kind: "task-completed",
                  to: recipient.email,
                  subject: `${taskRef} has been completed`,
                  text: `A task in ${project.project_name} has been marked as done.\n\n${taskRef}: ${row.title}\n\nView completed task: ${url}`,
                  html: `<p>A task in <strong>${escapeEmailHtml(project.project_name)}</strong> has been marked as done.</p><p><strong>${escapeEmailHtml(taskRef)}</strong><br>${escapeEmailHtml(row.title)}</p><p><a href="${escapeEmailHtml(url)}">View completed task</a></p>`,
                });
              }
            }
          }
        }
      }
      if (body.table === "shifts" && body.operation === "insert") {
        for (const shift of result.rows) {
          const profile = await getPool().query("SELECT email FROM profiles WHERE id=$1", [shift.assignee_id]);
          if (profile.rows[0]?.email) await sendTransactionalEmail({ kind: "shift-assignment", to: profile.rows[0].email, subject: "A shift was assigned to you", text: `Your shift starts at ${shift.start_at}.` });
        }
      }
      if (body.table === "shift_swap_requests" && ["insert", "update"].includes(body.operation) && row) {
        const url = row.kind === "coverage" ? `${getServerConfig().appUrl}/app/shifts` : `${getServerConfig().appUrl}/shift-request/${row.action_token}`;
        const shiftResult = await getPool().query("SELECT s.start_at,s.end_at,COALESCE(st.label,'Shift') label FROM shifts s LEFT JOIN shift_types st ON st.id=s.shift_type_id WHERE s.id=$1", [row.from_shift_id]);
        const shift = shiftResult.rows[0];
        const current = shift ? `${new Date(shift.start_at).toLocaleString()} – ${new Date(shift.end_at).toLocaleString()}` : "See the request for details";
        const preferred = row.preferred_start_at && row.preferred_end_at ? `${new Date(row.preferred_start_at).toLocaleString()} – ${new Date(row.preferred_end_at).toLocaleString()}` : "No date or time change requested";
        let recipients;
        if (body.operation === "update") recipients = await getPool().query("SELECT COALESCE(p.email,u.email) email FROM \"user\" u LEFT JOIN profiles p ON p.id=u.id WHERE u.id=$1", [row.from_user_id]);
        else if (row.to_user_id) recipients = await getPool().query("SELECT COALESCE(p.email,u.email) email FROM \"user\" u LEFT JOIN profiles p ON p.id=u.id WHERE u.id=$1", [row.to_user_id]);
        else recipients = await getPool().query(`SELECT DISTINCT COALESCE(p.email,u.email) email FROM organization_members m JOIN "user" u ON u.id=m.user_id LEFT JOIN profiles p ON p.id=m.user_id WHERE m.organization_id=$1 AND m.user_id<>$2 AND ($3='open' OR m.role IN ('owner','admin','manager'))`, [row.organization_id, row.from_user_id, row.kind]);
        for (const recipient of recipients.rows) if (recipient.email) await sendTransactionalEmail({ kind: body.operation === "insert" ? "shift-swap-request" : "shift-swap-decision", to: recipient.email, subject: body.operation === "insert" ? `Shift request: ${shift?.label ?? "Shift"}` : "Shift request updated", text: body.operation === "insert" ? `Current shift: ${current}\nRequested change: ${preferred}\nReason: ${row.reason ?? "Not provided"}\nReview: ${url}` : `The shift request status is ${row.status}.`, html: body.operation === "insert" ? `<p>A teammate sent a shift request.</p><p><strong>Current shift</strong><br>${escapeEmailHtml(shift?.label ?? "Shift")}<br>${escapeEmailHtml(current)}</p><p><strong>Requested change</strong><br>${escapeEmailHtml(preferred)}</p>${row.reason ? `<p><strong>Reason</strong><br>${escapeEmailHtml(row.reason)}</p>` : ""}<p><a href="${url}">Review and respond</a></p>` : undefined });
      }
      if (body.table === "shift_absences" && body.operation === "insert" && row) {
        const integration = await getPool().query("SELECT hr_integration_enabled,hr_system_name,hr_webhook_url FROM shift_settings WHERE organization_id=$1", [row.organization_id]);
        const target = integration.rows[0];
        if (target?.hr_integration_enabled && target.hr_webhook_url) {
          const webhook = new URL(target.hr_webhook_url);
          const blocked = webhook.protocol !== "https:" || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/i.test(webhook.hostname);
          if (blocked) throw new Error("HR webhook must use a public HTTPS address");
          await fetch(webhook, { method: "POST", headers: { "content-type": "application/json", ...(getServerConfig().hrWebhookSecret ? { authorization: `Bearer ${getServerConfig().hrWebhookSecret}` } : {}) }, body: JSON.stringify({ event: "absence.reported", system: target.hr_system_name, absence: row }) });
        }
      }
    } catch (mailError) { console.error("Unable to queue notification email", mailError); }
    const data = body.single || body.maybeSingle ? (result.rows[0] ?? null) : result.rows;
    return Response.json({ data, error: null });
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : "Database request failed";
    return Response.json({ data: null, error: { message } }, { status: 400 });
  } finally { client.release(); }
}
