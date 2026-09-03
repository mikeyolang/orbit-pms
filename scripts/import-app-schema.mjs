import { readFile, readdir } from "node:fs/promises";
import process from "node:process";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

function splitSql(source) {
  const statements = [];
  let current = "";
  let quote = null;
  let dollar = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (!quote && !dollar && ch === "-" && next === "-") {
      while (i < source.length && source[i] !== "\n") i++;
      current += "\n";
      continue;
    }
    if (!quote && ch === "$") {
      const match = source.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        if (!dollar) dollar = match[0];
        else if (dollar === match[0]) dollar = null;
        current += match[0];
        i += match[0].length - 1;
        continue;
      }
    }
    if (!dollar && (ch === "'" || ch === '"')) {
      if (!quote) quote = ch;
      else if (quote === ch && next === ch) {
        current += ch + next;
        i++;
        continue;
      } else if (quote === ch) quote = null;
    }
    current += ch;
    if (ch === ";" && !quote && !dollar) {
      statements.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const skipPatterns = [
  /^REVOKE\b/i,
  /^ALTER PUBLICATION\b/i,
  /^CREATE TYPE\s+public\.org_role\b/i,
  /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?public\.(?:profiles|organizations|organization_members|invitations)\b/i,
  /^CREATE (?:OR REPLACE )?FUNCTION\s+public\.handle_new_user\b/i,
  /^CREATE TRIGGER\s+on_auth_user_created\b/i,
];

const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
const ignoredCodes = new Set(["42701", "42710", "42P07", "42P16"]);

try {
  await client.query("begin");
  await client.query(`create schema if not exists auth`);
  await client.query(`
    do $$ begin
      create role anon nologin;
    exception when duplicate_object then null; end $$;
    do $$ begin
      create role authenticated nologin;
    exception when duplicate_object then null; end $$;
    do $$ begin
      create role service_role nologin bypassrls;
    exception when duplicate_object then null; end $$
  `);
  await client.query(`grant authenticated to current_user`);
  await client.query(`
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('app.user_id', true), '')::uuid
    $$
  `);
  await client.query(`
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('app.jwt', true), '')::jsonb, '{}'::jsonb)
    $$
  `);

  let applied = 0;
  for (const file of files) {
    const source = await readFile(new URL(file, migrationsDir), "utf8");
    for (let statement of splitSql(source)) {
      if (!statement || skipPatterns.some((pattern) => pattern.test(statement))) continue;
      statement = statement.replaceAll(/auth\.users/gi, 'public."user"');
      await client.query("savepoint import_statement");
      try {
        await client.query(statement);
        await client.query("release savepoint import_statement");
        applied++;
      } catch (error) {
        await client.query("rollback to savepoint import_statement");
        await client.query("release savepoint import_statement");
        if (ignoredCodes.has(error.code)) continue;
        throw new Error(`${file}: ${error.message}`, { cause: error });
      }
    }
  }
  await client.query("commit");
  console.info(
    `Imported portable application schema (${applied} statements from ${files.length} migrations).`,
  );
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
