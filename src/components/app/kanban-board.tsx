import { useEffect, useMemo, useState } from "react";
import { postgres } from "@/integrations/postgres/client";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { NewTaskDialog } from "@/components/app/new-task-dialog";
import { TASK_STATUSES, TASK_PRIORITIES, type Task, type TaskStatus } from "@/lib/projects";

type ProfileLite = { id: string; full_name: string | null; email: string | null };

const columnStyles: Record<TaskStatus, { shell: string; header: string; dot: string; count: string; empty: string }> = {
  backlog: {
    shell: "border-slate-200/80 bg-slate-50/80 dark:border-slate-700/70 dark:bg-slate-900/45",
    header: "border-slate-200/80 bg-slate-100/90 dark:border-slate-700/70 dark:bg-slate-800/70",
    dot: "bg-slate-500",
    count: "border-slate-300 bg-white/80 text-slate-700 dark:border-slate-600 dark:bg-slate-950/60 dark:text-slate-200",
    empty: "border-slate-300/80 bg-white/40 dark:border-slate-700 dark:bg-slate-950/20",
  },
  todo: {
    shell: "border-cyan-200/80 bg-cyan-50/70 dark:border-cyan-900/70 dark:bg-cyan-950/25",
    header: "border-cyan-200/80 bg-cyan-100/80 dark:border-cyan-900/70 dark:bg-cyan-950/55",
    dot: "bg-cyan-500",
    count: "border-cyan-300 bg-white/80 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950/70 dark:text-cyan-200",
    empty: "border-cyan-300/80 bg-white/40 dark:border-cyan-900 dark:bg-cyan-950/20",
  },
  in_progress: {
    shell: "border-blue-200/80 bg-blue-50/70 dark:border-blue-900/70 dark:bg-blue-950/25",
    header: "border-blue-200/80 bg-blue-100/80 dark:border-blue-900/70 dark:bg-blue-950/55",
    dot: "bg-blue-500",
    count: "border-blue-300 bg-white/80 text-blue-800 dark:border-blue-800 dark:bg-blue-950/70 dark:text-blue-200",
    empty: "border-blue-300/80 bg-white/40 dark:border-blue-900 dark:bg-blue-950/20",
  },
  in_review: {
    shell: "border-violet-200/80 bg-violet-50/70 dark:border-violet-900/70 dark:bg-violet-950/25",
    header: "border-violet-200/80 bg-violet-100/80 dark:border-violet-900/70 dark:bg-violet-950/55",
    dot: "bg-violet-500",
    count: "border-violet-300 bg-white/80 text-violet-800 dark:border-violet-800 dark:bg-violet-950/70 dark:text-violet-200",
    empty: "border-violet-300/80 bg-white/40 dark:border-violet-900 dark:bg-violet-950/20",
  },
  done: {
    shell: "border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-900/70 dark:bg-emerald-950/25",
    header: "border-emerald-200/80 bg-emerald-100/80 dark:border-emerald-900/70 dark:bg-emerald-950/55",
    dot: "bg-emerald-500",
    count: "border-emerald-300 bg-white/80 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200",
    empty: "border-emerald-300/80 bg-white/40 dark:border-emerald-900 dark:bg-emerald-950/20",
  },
  cancelled: {
    shell: "border-rose-200/70 bg-rose-50/60 dark:border-rose-950/70 dark:bg-rose-950/20",
    header: "border-rose-200/70 bg-rose-100/70 dark:border-rose-950/70 dark:bg-rose-950/45",
    dot: "bg-rose-500",
    count: "border-rose-300 bg-white/80 text-rose-800 dark:border-rose-900 dark:bg-rose-950/70 dark:text-rose-200",
    empty: "border-rose-300/70 bg-white/40 dark:border-rose-950 dark:bg-rose-950/20",
  },
};

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
          className={`flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl border shadow-sm transition-all ${columnStyles[col.value].shell} ${
            overCol === col.value ? "scale-[1.01] ring-2 ring-primary/50 shadow-lg" : ""
          }`}
        >
          <div className={`flex items-center justify-between border-b px-3 py-3 ${columnStyles[col.value].header}`}>
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full shadow-sm ${columnStyles[col.value].dot}`} />
              <span className="text-xs font-semibold tracking-wide">{col.label}</span>
              <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${columnStyles[col.value].count}`}>{col.items.length}</Badge>
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
          <div className="flex-1 space-y-2 p-2.5">
            {col.items.length === 0 && (
              <div className={`rounded-xl border border-dashed px-3 py-8 text-center text-[11px] text-muted-foreground ${columnStyles[col.value].empty}`}>
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
                  className={`w-full cursor-grab rounded-xl border border-white/80 bg-white/90 p-3 text-left text-sm shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md active:cursor-grabbing dark:border-white/10 dark:bg-slate-950/75 ${
                    dragId === t.id ? "opacity-40" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-mono">{projectKey}-{t.number}</span>
                    {prio && <span className={prio.color}>• {prio.label}</span>}
                  </div>
                  <div className="mt-1.5 line-clamp-2 text-sm font-medium leading-5">{t.title}</div>
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
