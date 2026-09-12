import { createFileRoute } from "@tanstack/react-router";
import { handleTeamInvitations } from "@/server/team-invitations.server";

export const Route = createFileRoute("/api/team-invitations")({ server: { handlers: {
  GET: ({ request }) => handleTeamInvitations(request),
  POST: ({ request }) => handleTeamInvitations(request),
} } });
