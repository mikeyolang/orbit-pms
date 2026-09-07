import process from "node:process";
import { spawn } from "node:child_process";
import { drizzle } from "drizzle-orm/node-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const databaseSsl = ["1", "true", "yes", "on"].includes(
  (process.env.DATABASE_SSL ?? "false").toLowerCase(),
);
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 15_000,
  ssl: databaseSsl ? { rejectUnauthorized: true } : undefined,
});

async function applyMigrations(database, migrations, config) {
  // Commit each migration separately. PostgreSQL requires enum additions to
  // commit before a later migration can use the new value.
  for (const migration of migrations) {
    await database.dialect.migrate([migration], database.session, config);
  }
}

function runSchemaImporter() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/import-app-schema.mjs"], {
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Schema importer exited with ${signal ?? `code ${code}`}`));
    });
  });
}

try {
  console.info("Connecting to PostgreSQL...");
  await pool.query("select 1");
  const database = drizzle(pool);
  const migrationConfig = { migrationsFolder: "./drizzle" };

  // The first five migrations establish Better Auth, compatibility roles,
  // and the tables needed by the portable schema importer. Drizzle normally
  // applies the entire journal in one transaction, so bootstrap them first.
  console.info("Applying database bootstrap migrations...");
  const migrationFiles = readMigrationFiles(migrationConfig);
  await applyMigrations(database, migrationFiles.slice(0, 5), migrationConfig);

  const legacySchema = await pool.query(
    "select to_regclass('public.shift_swap_requests') is not null as ready",
  );
  if (!legacySchema.rows[0]?.ready) {
    console.info("A fresh database was detected. Importing the portable application schema...");
    await runSchemaImporter();
  }

  console.info("Applying pending database migrations...");
  await applyMigrations(database, migrationFiles, migrationConfig);
  console.info("Database migrations completed successfully.");
} catch (error) {
  console.error("Database migration failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
