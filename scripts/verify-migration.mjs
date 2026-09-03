import process from "node:process";
import pg from "pg";
if (!process.env.SOURCE_DATABASE_URL || !process.env.DATABASE_URL) throw new Error("SOURCE_DATABASE_URL and DATABASE_URL are required");
const source = new pg.Pool({ connectionString: process.env.SOURCE_DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });
const target = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const sourceTables = await source.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name");
let mismatch = false;
for (const { table_name: table } of sourceTables.rows) {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) continue;
  const exists = await target.query("select to_regclass($1) is not null as ok", [`public.${table}`]);
  if (!exists.rows[0].ok) { console.info(`${table}: missing in destination`); mismatch = true; continue; }
  const [a, b] = await Promise.all([source.query(`select count(*)::int as count from public."${table}"`), target.query(`select count(*)::int as count from public."${table}"`)]);
  const ok = a.rows[0].count === b.rows[0].count;
  console.info(`${table}: source=${a.rows[0].count} destination=${b.rows[0].count} ${ok ? "OK" : "MISMATCH"}`);
  mismatch ||= !ok;
}
await source.end(); await target.end();
if (mismatch) process.exitCode = 1;
