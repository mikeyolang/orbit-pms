import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { streamTaskChat } from "@/server/task-chat-live.server";

export const Route = createFileRoute("/api/task-chat/stream")({ server: { handlers: { GET: async ({ request }) => {
  const taskId = new URL(request.url).searchParams.get("taskId");
  if (!z.uuid().safeParse(taskId).success) return Response.json({ error: "Invalid task" }, { status: 400 });
  return streamTaskChat(request, taskId!);
} } } });
