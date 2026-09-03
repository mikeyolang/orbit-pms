import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { KanbanBoard } from "./kanban-board";
import type { Sprint, Task } from "@/lib/projects";
import { toast } from "sonner";

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

  if (sprints.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center text-sm text-muted-foreground">
        No sprints yet. Create one in the Sprints tab.
      </div>
    );
  }

  async function assignToSprint(taskId: string) {
    if (!sprint) return;
    const { error } = await supabase.from("tasks").update({ sprint_id: sprint.id }).eq("id", taskId);
    if (error) return toast.error(error.message);
    onChanged();
  }

  const backlog = tasks.filter((t) => !t.sprint_id && t.status !== "done" && t.status !== "cancelled");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/30 p-3">
        <div className="flex items-center gap-3">
          <Select value={sprint?.id ?? ""} onValueChange={setSprintId}>
            <SelectTrigger className="h-8 w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {sprints.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name} · {s.status}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sprint && (
            <Badge variant="outline" className="text-[10px] capitalize">{sprint.status}</Badge>
          )}
        </div>
        {sprint && (
          <div className="flex flex-1 items-center gap-3 min-w-[240px] justify-end">
            <div className="text-xs text-muted-foreground">{done}/{sprintTasks.length} done</div>
            <Progress value={pct} className="h-1.5 max-w-xs flex-1" />
            <div className="text-xs font-medium">{pct}%</div>
          </div>
        )}
      </div>

      {sprint && (
        <KanbanBoard tasks={sprintTasks} projectKey={projectKey} onOpen={onOpen} onChanged={onChanged} />
      )}

      {backlog.length > 0 && sprint && (
        <div className="rounded-xl border border-border/60 bg-card/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-medium">Backlog · drag-free quick add</h4>
            <span className="text-[10px] text-muted-foreground">{backlog.length} unassigned</span>
          </div>
          <ul className="space-y-1">
            {backlog.slice(0, 8).map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-sm">
                <span className="font-mono text-[10px] text-muted-foreground">{projectKey}-{t.number}</span>
                <button className="flex-1 truncate text-left hover:text-primary" onClick={() => onOpen(t)}>{t.title}</button>
                <button
                  onClick={() => assignToSprint(t.id)}
                  className="rounded border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                >Add to sprint</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
