import { createFileRoute } from "@tanstack/react-router";
import { handleDataRequest } from "@/server/data-api.server";

export const Route = createFileRoute("/api/data")({
  server: { handlers: { POST: ({ request }) => handleDataRequest(request) } },
});
