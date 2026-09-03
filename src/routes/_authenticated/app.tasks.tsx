import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { postgres } from "@/integrations/postgres/client";
import { useAuthSession } from "@/lib/auth";
import { useOrg } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckSquare, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/app/tasks")({
  component: MyTasksPage,
});

type TaskRow = {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  updated_at: string;
  project: { id: string; key: string; name: string; color: string } | null;
};

const STATUS_LABEL: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-red-500/15 text-red-400 border-red-500/30",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  medium: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  low: "bg-muted text-muted-foreground border-border",
};

function MyTasksPage() {
  const { user } = useAuthSession();
  const { currentOrg } = useOrg();
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [filter, setFilter] = useState<"open" | "all" | "done">("open");

  const load = useCallback(async () => {
    if (!user) return;
    setTasks(null);
    const { data: projects } = await postgres
      .from("projects")
      .select("id")
      .eq("organization_id", currentOrg.organization_id);
    const projectIds = (projects ?? []).map((p) => p.id);
    if (projectIds.length === 0) {
      setTasks([]);
      return;
    }
    const { data } = await postgres
      .from("tasks")
      .select("id, number, title, status, priority, due_date, updated_at, project:projects(id, key, name, color)")
      .eq("assignee_id", user.id)
      .in("project_id", projectIds)
      .order("updated_at", { ascending: false });
    setTasks((data as unknown as TaskRow[]) ?? []);
  }, [user, currentOrg.organization_id]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = (tasks ?? []).filter((t) => {
    if (filter === "open") return t.status !== "done" && t.status !== "cancelled";
    if (filter === "done") return t.status === "done";
    return true;
  });

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">Everything assigned to you across {currentOrg.organization.name}.</p>
        </div>
        <div className="flex gap-1 rounded-md border border-border bg-card p-0.5">
          {(["open", "all", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-3 py-1 text-xs capitalize transition-colors ${
                filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
        {tasks === null ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <CheckSquare className="h-8 w-8 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-medium">Nothing here</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              You have no {filter === "open" ? "open" : filter} tasks assigned in this workspace.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-4">
              <Link to="/app/projects">Browse projects</Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((t) => (
              <li key={t.id} className="flex items-center gap-4 px-4 py-3 hover:bg-accent/40">
                <div className="grid h-8 w-8 place-items-center rounded-md text-xs font-medium text-white" style={{ backgroundColor: t.project?.color ?? "#6366f1" }}>
                  {t.project?.key?.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t.project?.key}-{t.number}
                    </span>
                    <Link
                      to="/app/projects/$key"
                      params={{ key: t.project?.key ?? "" }}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {t.title}
                    </Link>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Updated {formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}
                    {t.due_date && ` · Due ${new Date(t.due_date).toLocaleDateString()}`}
                  </div>
                </div>
                <Badge variant="outline" className={PRIORITY_TONE[t.priority] ?? PRIORITY_TONE.low}>
                  {t.priority}
                </Badge>
                <Badge variant="outline" className="border-border text-xs">
                  {STATUS_LABEL[t.status] ?? t.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
