import process from "node:process";
import pg from "pg";

if (!process.env.SOURCE_DATABASE_URL) throw new Error("SOURCE_DATABASE_URL (the Supabase direct Postgres URL) is required");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL (the destination Postgres URL) is required");
if (process.env.SOURCE_DATABASE_URL === process.env.DATABASE_URL) throw new Error("Source and destination must be different");

const source = new pg.Pool({ connectionString: process.env.SOURCE_DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });
const target = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const tables = ["profiles", "organizations", "organization_members", "invitations", "projects", "project_members", "milestones", "sprints", "labels", "tasks", "task_labels", "task_dependencies", "task_comments", "task_activity", "teams", "team_members", "role_permissions", "member_permissions", "join_requests", "shift_settings", "shift_types", "shift_series", "shifts", "shift_swap_requests"];
const q = (name) => `"${name.replaceAll('"', '""')}"`;

async function columns(pool, schema, table) {
  const result = await pool.query("select column_name from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position", [schema, table]);
  return result.rows.map((row) => row.column_name);
}

async function insertRows(client, table, cols, rows) {
  for (const row of rows) {
    const values = cols.map((column) => row[column]);
    const slots = values.map((_, index) => `$${index + 1}`);
    await client.query(`insert into public.${q(table)} (${cols.map(q).join(",")}) values (${slots.join(",")}) on conflict do nothing`, values);
  }
}

const client = await target.connect();
try {
  await client.query("begin");
  const users = await source.query("select id, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at from auth.users order by created_at");
  for (const user of users.rows) {
    await client.query(`insert into public."user" (id,name,email,email_verified,created_at,updated_at) values ($1,$2,$3,$4,$5,$6) on conflict (id) do update set name=excluded.name,email=excluded.email,email_verified=excluded.email_verified,updated_at=excluded.updated_at`, [user.id, user.raw_user_meta_data?.full_name ?? user.email?.split("@")[0] ?? "User", user.email, Boolean(user.email_confirmed_at), user.created_at, user.updated_at]);
  }
  console.info(`users: ${users.rowCount}`);
  for (const table of tables) {
    const sourceColumns = await columns(source, "public", table);
    const targetColumns = await columns(target, "public", table);
    if (!sourceColumns.length || !targetColumns.length) continue;
    const shared = sourceColumns.filter((column) => targetColumns.includes(column));
    const result = await source.query(`select ${shared.map(q).join(",")} from public.${q(table)}`);
    await insertRows(client, table, shared, result.rows);
    console.info(`${table}: ${result.rowCount}`);
  }
  await client.query("commit");
  console.info("Data migration complete. Existing users must use password reset to create a Better Auth password.");
} catch (error) { await client.query("rollback"); throw error; }
finally { client.release(); await source.end(); await target.end(); }
