import { useEffect, useMemo, useState } from "react";
import { postgres } from "@/integrations/postgres/client";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { NewTaskDialog } from "@/components/app/new-task-dialog";
import { TASK_STATUSES, TASK_PRIORITIES, type Task, type TaskStatus } from "@/lib/projects";

type ProfileLite = { id: string; full_name: string | null; email: string | null };

function initials(name: string | null | undefined, email: string | null | undefined) {
  const source = name?.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function colorFor(id: string) {
  const palette = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

export function KanbanBoard({
  tasks, projectKey, projectId, onOpen, onChanged,
}: {
  tasks: Task[];
  projectKey: string;
  projectId?: string;
  onOpen: (t: Task) => void;
  onChanged: () => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});

  const assigneeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) if (t.assignee_id) ids.add(t.assignee_id);
    return Array.from(ids);
  }, [tasks]);

  useEffect(() => {
    const missing = assigneeIds.filter((id) => !profiles[id]);
    if (missing.length === 0) return;
    postgres
      .from("profiles")
      .select("id, full_name, email")
      .in("id", missing)
      .then(({ data }) => {
        if (!data) return;
        setProfiles((prev) => {
          const next = { ...prev };
          for (const p of data) next[p.id] = p as ProfileLite;
          return next;
        });
      });
  }, [assigneeIds, profiles]);

  const columns = useMemo(() => {
    return TASK_STATUSES.map((s) => ({
      ...s,
      items: tasks
        .filter((t) => t.status === s.value)
        .sort((a, b) => a.order_index - b.order_index),
    }));
  }, [tasks]);

  async function moveTo(id: string, status: TaskStatus) {
    const target = tasks.find((t) => t.id === id);
    if (!target || target.status === status) { setDragId(null); setOverCol(null); return; }
    const colMax = tasks
      .filter((t) => t.status === status)
      .reduce((m, t) => Math.max(m, t.order_index), 0);
    const { error } = await postgres
      .from("tasks")
      .update({ status, order_index: colMax + 1024 })
      .eq("id", id);
    setDragId(null);
    setOverCol(null);
    if (error) return toast.error(error.message);
    onChanged();
  }

  return (
    <div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-2">
      {columns.map((col) => (
        <div
          key={col.value}
          onDragOver={(e) => { e.preventDefault(); setOverCol(col.value); }}
          onDragLeave={() => setOverCol((c) => (c === col.value ? null : c))}
          onDrop={() => dragId && moveTo(dragId, col.value)}
          className={`flex w-72 shrink-0 flex-col rounded-xl border bg-card/30 transition-colors ${
            overCol === col.value ? "border-primary/60 bg-card/60" : "border-border/60"
          }`}
        >
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{col.label}</span>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{col.items.length}</Badge>
            </div>
            {projectId && (
              <NewTaskDialog
                projectId={projectId}
                defaultStatus={col.value}
                onCreated={onChanged}
                trigger={
                  <button
                    type="button"
                    aria-label={`Add task to ${col.label}`}
                    className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                }
              />
            )}
          </div>
          <div className="flex-1 space-y-1.5 p-2">
            {col.items.length === 0 && (
              <div className="rounded-md border border-dashed border-border/40 px-3 py-6 text-center text-[11px] text-muted-foreground">
                Drop tasks here
              </div>
            )}
            {col.items.map((t) => {
              const prio = TASK_PRIORITIES.find((p) => p.value === t.priority);
              const overdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== "done" && t.status !== "cancelled";
              const assignee = t.assignee_id ? profiles[t.assignee_id] : null;
              return (
                <button
                  key={t.id}
                  type="button"
                  draggable
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => onOpen(t)}
                  className={`w-full cursor-grab rounded-md border border-border/60 bg-background/60 p-2.5 text-left text-sm transition hover:border-border hover:bg-background/90 active:cursor-grabbing ${
                    dragId === t.id ? "opacity-40" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-mono">{projectKey}-{t.number}</span>
                    {prio && <span className={prio.color}>• {prio.label}</span>}
                  </div>
                  <div className="mt-1 line-clamp-2 text-sm">{t.title}</div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <div className="flex items-center gap-2">
                      {t.story_points != null && <span>{t.story_points} pts</span>}
                      {t.due_date && (
                        <span className={overdue ? "text-red-500 dark:text-red-400" : ""}>
                          {new Date(t.due_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {t.assignee_id ? (
                      <div
                        className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-white ring-2 ring-background"
                        style={{ backgroundColor: colorFor(t.assignee_id) }}
                        title={assignee?.full_name ?? assignee?.email ?? "Assigned"}
                      >
                        {initials(assignee?.full_name, assignee?.email)}
                      </div>
                    ) : (
                      <span
                        className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-border text-[9px] text-muted-foreground"
                        title="Unassigned"
                      >
                        ?
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
