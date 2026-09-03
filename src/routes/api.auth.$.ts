import { createFileRoute } from "@tanstack/react-router";

import { getAuth } from "@/server/auth.server";

async function handleAuthRequest({ request }: { request: Request }) {
  return getAuth().handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: handleAuthRequest,
      POST: handleAuthRequest,
    },
  },
});
