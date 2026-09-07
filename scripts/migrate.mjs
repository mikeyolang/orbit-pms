import process from "node:process";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
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

try {
  console.info("Connecting to PostgreSQL...");
  await pool.query("select 1");
  console.info("Applying pending database migrations...");
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.info("Database migrations completed successfully.");
} catch (error) {
  console.error("Database migration failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
