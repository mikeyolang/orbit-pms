import { sql } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";

import { getDb } from "@/server/db/client.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          await getDb().execute(sql`select 1`);
          return Response.json({ status: "ok", database: "connected" });
        } catch (error) {
          console.error("Database health check failed", error);
          return Response.json(
            { status: "unavailable", database: "disconnected" },
            { status: 503 },
          );
        }
      },
    },
  },
});
