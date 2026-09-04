import { useMemo, useState } from "react";
import { postgres } from "@/integrations/postgres/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { KanbanBoard } from "./kanban-board";
import type { Sprint, Task } from "@/lib/projects";
import { toast } from "sonner";
import { CalendarDays, CheckCircle2, Flag, Layers3, Plus, Sparkles, Target } from "lucide-react";

export function SprintBoard({
  sprints, tasks, projectKey, onOpen, onChanged,
}: {
  sprints: Sprint[];
  tasks: Task[];
  projectKey: string;
  onOpen: (t: Task) => void;
  onChanged: () => void;
}) {
  const active = sprints.find((s) => s.status === "active") ?? sprints[0];
  const [sprintId, setSprintId] = useState<string | null>(active?.id ?? null);
  const sprint = sprints.find((s) => s.id === sprintId) ?? active;

  const sprintTasks = useMemo(
    () => (sprint ? tasks.filter((t) => t.sprint_id === sprint.id) : []),
    [sprint, tasks]
  );
  const done = sprintTasks.filter((t) => t.status === "done").length;
  const pct = sprintTasks.length === 0 ? 0 : Math.round((done / sprintTasks.length) * 100);
  const totalPoints = sprintTasks.reduce((sum, task) => sum + Number(task.story_points ?? 0), 0);

  if (sprints.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-indigo-300 bg-gradient-to-br from-indigo-50 via-violet-50 to-sky-50 px-6 py-16 text-center dark:border-indigo-800 dark:from-indigo-950/50 dark:via-violet-950/30 dark:to-sky-950/30">
        <Sparkles className="mx-auto h-8 w-8 text-indigo-500" />
        <h3 className="mt-3 font-semibold">Your sprint board is ready</h3>
        <p className="mt-1 text-sm text-muted-foreground">Create a sprint in the Sprints tab, then bring tasks into focus here.</p>
      </div>
    );
  }

  async function assignToSprint(taskId: string) {
    if (!sprint) return;
    const { error } = await postgres.from("tasks").update({ sprint_id: sprint.id }).eq("id", taskId);
    if (error) return toast.error(error.message);
    onChanged();
  }

  const backlog = tasks.filter((t) => !t.sprint_id && t.status !== "done" && t.status !== "cancelled");

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-600 via-violet-600 to-blue-700 p-5 text-white shadow-lg shadow-indigo-500/15 dark:border-indigo-800">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-cyan-300/15 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-100">
              <Layers3 className="h-4 w-4" /> Sprint workspace
            </div>
          <Select value={sprint?.id ?? ""} onValueChange={setSprintId}>
            <SelectTrigger className="h-10 w-72 border-white/20 bg-white/15 font-semibold text-white shadow-sm hover:bg-white/20"><SelectValue /></SelectTrigger>
            <SelectContent>
              {sprints.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name} · {s.status}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sprint && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-indigo-100">
              <Badge className="border-white/20 bg-white/15 text-white hover:bg-white/15">{sprint.status}</Badge>
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />{sprint.start_date ? new Date(sprint.start_date).toLocaleDateString() : "Start TBD"} – {sprint.end_date ? new Date(sprint.end_date).toLocaleDateString() : "End TBD"}</span>
            </div>
          )}
        </div>
        {sprint && (
          <div className="grid min-w-[280px] grid-cols-3 gap-2">
            <SprintMetric icon={Target} label="Tasks" value={sprintTasks.length} />
            <SprintMetric icon={CheckCircle2} label="Done" value={done} />
            <SprintMetric icon={Flag} label="Points" value={totalPoints} />
          </div>
        )}
        </div>
        {sprint && (
          <div className="relative mt-5 rounded-xl bg-black/10 p-3 backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-indigo-50">Sprint progress</span>
              <span className="font-bold">{pct}%</span>
            </div>
            <Progress value={pct} className="h-2.5 bg-white/20 [&>div]:bg-white" />
            {sprint.goal && <p className="mt-3 text-sm text-indigo-50/90"><span className="font-semibold text-white">Goal:</span> {sprint.goal}</p>}
          </div>
        )}
      </section>

      {sprint && (
        <KanbanBoard tasks={sprintTasks} projectKey={projectKey} onOpen={onOpen} onChanged={onChanged} />
      )}

      {backlog.length > 0 && sprint && (
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50/60 p-4 shadow-sm dark:border-amber-900/70 dark:from-amber-950/30 dark:to-orange-950/20">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold">Ready from the backlog</h4>
              <p className="text-xs text-muted-foreground">Add unassigned work to this sprint.</p>
            </div>
            <Badge variant="outline" className="border-amber-300 bg-white/70 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">{backlog.length} available</Badge>
          </div>
          <ul className="space-y-1">
            {backlog.slice(0, 8).map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded-xl border border-amber-200/80 bg-white/80 px-3 py-2.5 text-sm shadow-sm dark:border-amber-900/60 dark:bg-slate-950/60">
                <span className="font-mono text-[10px] text-muted-foreground">{projectKey}-{t.number}</span>
                <button className="flex-1 truncate text-left hover:text-primary" onClick={() => onOpen(t)}>{t.title}</button>
                <button
                  onClick={() => assignToSprint(t.id)}
                  className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1.5 text-[10px] font-semibold text-white shadow-sm transition hover:bg-amber-600"
                ><Plus className="h-3 w-3" /> Add to sprint</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SprintMetric({ icon: Icon, label, value }: { icon: typeof Target; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/10 p-3 text-center backdrop-blur-sm">
      <Icon className="mx-auto h-4 w-4 text-indigo-100" />
      <div className="mt-1 text-xl font-bold">{value}</div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-indigo-100">{label}</div>
    </div>
  );
}
