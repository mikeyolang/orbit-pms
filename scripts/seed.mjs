import { randomUUID } from "node:crypto";
import process from "node:process";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const email = (process.env.SEED_USER_EMAIL ?? "demo@orbit.local").toLowerCase();
const name = process.env.SEED_USER_NAME ?? "Orbit Demo";
const password = process.env.SEED_USER_PASSWORD ?? "OrbitDemo123!";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

try {
  await client.query("begin");
  const existing = await client.query('select id from "user" where email = $1', [email]);
  const userId = existing.rows[0]?.id ?? randomUUID();

  await client.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, $2, $3, true)
     on conflict (email) do update set name = excluded.name, updated_at = now()`,
    [userId, name, email],
  );
  const passwordHash = await hashPassword(password);
  const credentialAccount = await client.query(
    `select id from account where user_id = $1 and provider_id = 'credential' limit 1`,
    [userId],
  );
  if (credentialAccount.rows[0]) {
    await client.query(
      `update account set password = $1, issuer = 'local:credential', updated_at = now() where id = $2`,
      [passwordHash, credentialAccount.rows[0].id],
    );
  } else {
    await client.query(
      `insert into account (id, account_id, provider_id, issuer, user_id, password)
       values ($1, $2, 'credential', 'local:credential', $3, $4)`,
      [randomUUID(), userId, userId, passwordHash],
    );
  }
  await client.query(
    `insert into profiles (id, full_name, email)
     values ($1, $2, $3)
     on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, updated_at = now()`,
    [userId, name, email],
  );

  const organizationId = randomUUID();
  await client.query(
    `insert into organizations (id, name, slug, created_by)
     values ($1, 'Orbit Demo Workspace', 'orbit-demo', $2)
     on conflict (slug) do nothing`,
    [organizationId, userId],
  );
  const organization = await client.query("select id from organizations where slug = 'orbit-demo'");
  await client.query(
    `insert into organization_members (organization_id, user_id, role)
     values ($1, $2, 'owner')
     on conflict (organization_id, user_id) do update set role = 'owner'`,
    [organization.rows[0].id, userId],
  );
  await client.query("commit");
  console.info(`Seeded local workspace. Sign in with ${email} / ${password}`);
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
