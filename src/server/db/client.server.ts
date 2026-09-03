import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { requireServerConfig } from "@/lib/config.server";
import * as schema from "./schema";

let pool: Pool | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getPool() {
  if (!pool) {
    const { databaseUrl, nodeEnv } = requireServerConfig("databaseUrl");
    pool = new Pool({
      connectionString: databaseUrl,
      max: nodeEnv === "production" ? 10 : 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: nodeEnv === "production" ? { rejectUnauthorized: true } : undefined,
    });
  }
  return pool;
}

export function getDb() {
  if (!database) database = drizzle(getPool(), { schema });
  return database;
}

export async function withUserTransaction<T>(userId: string, work: (tx: any) => Promise<T>) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return work(tx);
  });
}
