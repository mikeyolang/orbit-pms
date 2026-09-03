import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";

interface Comment {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  author?: { full_name: string | null; email: string | null } | null;
}

interface Activity {
  id: string;
  task_id: string;
  actor_id: string | null;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
  actor?: { full_name: string | null; email: string | null } | null;
}

export function TaskCommentsActivity({ taskId }: { taskId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  async function loadAll() {
    const [{ data: c }, { data: a }] = await Promise.all([
      supabase.from("task_comments").select("*").eq("task_id", taskId).order("created_at"),
      supabase.from("task_activity").select("*").eq("task_id", taskId).order("created_at", { ascending: false }).limit(50),
    ]);
    const userIds = Array.from(new Set([
      ...((c ?? []).map((x) => x.author_id)),
      ...((a ?? []).map((x) => x.actor_id).filter(Boolean) as string[]),
    ]));
    const profileMap = new Map<string, { full_name: string | null; email: string | null }>();
    if (userIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", userIds);
      (profs ?? []).forEach((p) => profileMap.set(p.id, { full_name: p.full_name, email: p.email }));
    }
    setComments((c ?? []).map((x) => ({ ...x, author: profileMap.get(x.author_id) ?? null })) as Comment[]);
    setActivity((a ?? []).map((x) => ({
      ...x,
      payload: (x.payload ?? {}) as Record<string, unknown>,
      actor: x.actor_id ? profileMap.get(x.actor_id) ?? null : null,
    })) as Activity[]);
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    loadAll();
    const channel = supabase
      .channel(`task-${taskId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments", filter: `task_id=eq.${taskId}` }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "task_activity", filter: `task_id=eq.${taskId}` }, () => loadAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function postComment() {
    if (!body.trim()) return;
    if (!me) return;
    setPosting(true);
    const { error } = await supabase.from("task_comments").insert({
      task_id: taskId, author_id: me, body: body.trim(),
    });
    setPosting(false);
    if (error) return toast.error(error.message);
    setBody("");
    await supabase.from("task_activity").insert({
      task_id: taskId, actor_id: me, action: "commented", payload: {},
    });
  }

  async function deleteComment(id: string) {
    const { error } = await supabase.from("task_comments").delete().eq("id", id);
    if (error) toast.error(error.message);
  }

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs font-medium text-muted-foreground">Comments</Label>
        <div className="mt-2 space-y-2">
          {comments.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
          {comments.map((c) => (
            <div key={c.id} className="rounded-md border border-border/60 bg-card/30 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <div className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[10px]">
                    {(c.author?.full_name ?? c.author?.email ?? "?")[0]?.toUpperCase()}
                  </div>
                  <span className="font-medium">{c.author?.full_name ?? c.author?.email ?? "Unknown"}</span>
                  <span className="text-muted-foreground">{new Date(c.created_at).toLocaleString()}</span>
                </div>
                {me === c.author_id && (
                  <button onClick={() => deleteComment(c.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm">{c.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-2 space-y-2">
          <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment…" />
          <div className="flex justify-end">
            <Button size="sm" disabled={posting || !body.trim()} onClick={postComment}>
              {posting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}Post
            </Button>
          </div>
        </div>
      </div>

      <div>
        <Label className="text-xs font-medium text-muted-foreground">Activity</Label>
        {activity.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {activity.map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                <div className="flex-1">
                  <span className="text-foreground">{a.actor?.full_name ?? a.actor?.email ?? "Someone"}</span>{" "}
                  {formatAction(a)}
                  <span className="ml-2 text-[10px]">{new Date(a.created_at).toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatAction(a: Activity): string {
  const p = a.payload as Record<string, string | undefined>;
  switch (a.action) {
    case "commented": return "commented";
    case "status_changed": return `changed status ${p.from ?? "?"} → ${p.to ?? "?"}`;
    case "assigned": return `assigned to ${p.assignee ?? "someone"}`;
    case "priority_changed": return `set priority to ${p.to ?? "?"}`;
    case "created": return "created the task";
    default: return a.action.replace(/_/g, " ");
  }
}
