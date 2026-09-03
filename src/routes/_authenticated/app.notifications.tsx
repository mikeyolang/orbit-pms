import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSession } from "@/lib/auth";
import { useOrg } from "@/components/app/app-shell";
import { Bell, Loader2, MessageSquare, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/app/notifications")({
  component: InboxPage,
});

type ActivityItem = {
  kind: "activity";
  id: string;
  created_at: string;
  action: string;
  actor_id: string | null;
  task: { id: string; number: number; title: string; project: { key: string; name: string; color: string } | null };
  actor?: { full_name: string | null; email: string | null } | null;
};
type CommentItem = {
  kind: "comment";
  id: string;
  created_at: string;
  body: string;
  author_id: string;
  task: { id: string; number: number; title: string; project: { key: string; name: string; color: string } | null };
  author?: { full_name: string | null; email: string | null } | null;
};
type InboxItem = ActivityItem | CommentItem;

function InboxPage() {
  const { user } = useAuthSession();
  const { currentOrg } = useOrg();
  const [items, setItems] = useState<InboxItem[] | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setItems(null);

    const { data: projects } = await supabase
      .from("projects")
      .select("id")
      .eq("organization_id", currentOrg.organization_id);
    const projectIds = (projects ?? []).map((p) => p.id);
    if (projectIds.length === 0) {
      setItems([]);
      return;
    }

    const { data: myTasks } = await supabase
      .from("tasks")
      .select("id")
      .in("project_id", projectIds)
      .or(`assignee_id.eq.${user.id},reporter_id.eq.${user.id},created_by.eq.${user.id}`);
    const taskIds = (myTasks ?? []).map((t) => t.id);
    if (taskIds.length === 0) {
      setItems([]);
      return;
    }

    const [act, com] = await Promise.all([
      supabase
        .from("task_activity")
        .select("id, created_at, action, actor_id, task:tasks(id, number, title, project:projects(key, name, color))")
        .in("task_id", taskIds)
        .neq("actor_id", user.id)
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("task_comments")
        .select("id, created_at, body, author_id, task:tasks(id, number, title, project:projects(key, name, color))")
        .in("task_id", taskIds)
        .neq("author_id", user.id)
        .order("created_at", { ascending: false })
        .limit(40),
    ]);

    const actorIds = new Set<string>();
    (act.data ?? []).forEach((a: any) => a.actor_id && actorIds.add(a.actor_id));
    (com.data ?? []).forEach((c: any) => actorIds.add(c.author_id));
    let profileMap = new Map<string, { full_name: string | null; email: string | null }>();
    if (actorIds.size > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", Array.from(actorIds));
      (profs ?? []).forEach((p) => profileMap.set(p.id, { full_name: p.full_name, email: p.email }));
    }

    const activities: ActivityItem[] = (act.data ?? []).map((a: any) => ({
      kind: "activity",
      id: a.id,
      created_at: a.created_at,
      action: a.action,
      actor_id: a.actor_id,
      task: a.task,
      actor: a.actor_id ? profileMap.get(a.actor_id) ?? null : null,
    }));
    const comments: CommentItem[] = (com.data ?? []).map((c: any) => ({
      kind: "comment",
      id: c.id,
      created_at: c.created_at,
      body: c.body,
      author_id: c.author_id,
      task: c.task,
      author: profileMap.get(c.author_id) ?? null,
    }));

    const merged = [...activities, ...comments].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    setItems(merged);
  }, [user, currentOrg.organization_id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">Recent activity and comments on tasks you're involved with.</p>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
        {items === null ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <Bell className="h-8 w-8 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-medium">You're all caught up</h3>
            <p className="mt-1 text-sm text-muted-foreground">Nothing new on your tasks yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const author = item.kind === "comment" ? item.author : item.actor;
              const who = author?.full_name ?? author?.email ?? "Someone";
              return (
                <li key={`${item.kind}-${item.id}`} className="flex gap-3 px-4 py-3 hover:bg-accent/40">
                  <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-xs">
                    {item.kind === "comment" ? <MessageSquare className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      <span className="font-medium">{who}</span>{" "}
                      <span className="text-muted-foreground">
                        {item.kind === "comment" ? "commented on" : `${item.action.replace(/_/g, " ")} on`}
                      </span>{" "}
                      <Link
                        to="/app/projects/$key"
                        params={{ key: item.task.project?.key ?? "" }}
                        className="font-medium hover:underline"
                      >
                        {item.task.project?.key}-{item.task.number} {item.task.title}
                      </Link>
                    </div>
                    {item.kind === "comment" && (
                      <p className="mt-1 line-clamp-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        {item.body}
                      </p>
                    )}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
