import { createFileRoute } from "@tanstack/react-router";
import { getServerConfig } from "@/lib/config.server";
import { processOverdueNotifications } from "@/server/overdue-notifications.server";

export const Route = createFileRoute("/api/notifications/process")({ server: { handlers: { POST: async ({ request }) => {
  const secret = getServerConfig().cronSecret;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await processOverdueNotifications());
} } } });
