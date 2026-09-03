import { useEffect, useState } from "react";
import { postgres } from "@/integrations/postgres/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trash2, Link2, Plus, X } from "lucide-react";
import {
  TASK_PRIORITIES, TASK_STATUSES, type Task, type Label as LabelRow,
} from "@/lib/projects";
import { NewTaskDialog } from "./new-task-dialog";
import { TaskCommentsActivity } from "./task-comments";
import { MemberCombobox } from "./member-combobox";

interface Member { user_id: string; full_name: string | null; email: string | null }

export function TaskDetailSheet({
  task, open, onOpenChange, onChanged, projectKey,
}: {
  task: Task | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
  projectKey: string;
}) {
  const [t, setT] = useState<Task | null>(task);
  const [members, setMembers] = useState<Member[]>([]);
  const [labels, setLabels] = useState<LabelRow[]>([]);
  const [taskLabels, setTaskLabels] = useState<string[]>([]);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [deps, setDeps] = useState<{ id: string; depends_on: Task }[]>([]);
  const [allProjectTasks, setAllProjectTasks] = useState<Task[]>([]);
  const [addingDep, setAddingDep] = useState<string>("none");

  useEffect(() => { setT(task); }, [task]);

  useEffect(() => {
    if (!t) return;
    (async () => {
      const { data: project } = await postgres.from("projects").select("organization_id").eq("id", t.project_id).single();
      if (!project) return;
      const [{ data: mems }, { data: lbs }, { data: tlabels }, { data: subs }, { data: ds }, { data: all }] = await Promise.all([
        postgres.from("organization_members").select("user_id").eq("organization_id", project.organization_id).eq("can_access_projects", true),
        postgres.from("labels").select("*").eq("organization_id", project.organization_id).order("name"),
        postgres.from("task_labels").select("label_id").eq("task_id", t.id),
        postgres.from("tasks").select("*").eq("parent_task_id", t.id).order("number"),
        postgres.from("task_dependencies")
          .select("id, depends_on:tasks!task_dependencies_depends_on_task_id_fkey(*)")
          .eq("task_id", t.id),
        postgres.from("tasks").select("*").eq("project_id", t.project_id).neq("id", t.id).order("number"),
      ]);
      const ids = (mems ?? []).map((m) => m.user_id);
      const { data: profiles } = ids.length
        ? await postgres.from("profiles").select("id, full_name, email").in("id", ids)
        : { data: [] as { id: string; full_name: string | null; email: string }[] };
      setMembers((profiles ?? []).map((p) => ({ user_id: p.id, full_name: p.full_name, email: p.email })));
      setLabels(lbs ?? []);
      setTaskLabels((tlabels ?? []).map((x) => x.label_id));
      setSubtasks(subs ?? []);
      setDeps((ds ?? []) as never);
      setAllProjectTasks(all ?? []);
    })();
  }, [t]);

  if (!t) return null;

  async function patch(updates: Partial<Task>) {
    if (!t) return;
    const prev = t;
    const next = { ...t, ...updates };
    setT(next);
    const { error } = await postgres.from("tasks").update(updates).eq("id", t.id);
    if (error) { toast.error(error.message); setT(prev); return; }
    // log activity for important field changes
    try {
      const { data: u } = await postgres.auth.getUser();
      const actor = u.user?.id ?? null;
      const events: { action: string; payload: Record<string, string> }[] = [];
      if (updates.status && updates.status !== prev.status) {
        events.push({ action: "status_changed", payload: { from: prev.status, to: updates.status } });
      }
      if (updates.priority && updates.priority !== prev.priority) {
        events.push({ action: "priority_changed", payload: { from: prev.priority, to: updates.priority } });
      }
      if ("assignee_id" in updates && updates.assignee_id !== prev.assignee_id) {
        const m = members.find((x) => x.user_id === updates.assignee_id);
        events.push({ action: "assigned", payload: { assignee: m?.full_name ?? m?.email ?? "Unassigned" } });
      }
      for (const e of events) {
        await postgres.from("task_activity").insert({ task_id: t.id, actor_id: actor, action: e.action, payload: e.payload as never });
      }
    } catch { /* non-blocking */ }
    onChanged();
  }

  async function toggleLabel(id: string) {
    if (!t) return;
    if (taskLabels.includes(id)) {
      await postgres.from("task_labels").delete().eq("task_id", t.id).eq("label_id", id);
      setTaskLabels(taskLabels.filter((x) => x !== id));
    } else {
      await postgres.from("task_labels").insert({ task_id: t.id, label_id: id });
      setTaskLabels([...taskLabels, id]);
    }
  }

  async function addDep() {
    if (!t || addingDep === "none") return;
    const { error } = await postgres.from("task_dependencies").insert({
      task_id: t.id, depends_on_task_id: addingDep, type: "blocks",
    });
    if (error) return toast.error(error.message);
    const dep = allProjectTasks.find((x) => x.id === addingDep);
    if (dep) setDeps([...deps, { id: crypto.randomUUID(), depends_on: dep }]);
    setAddingDep("none");
  }

  async function removeDep(id: string) {
    await postgres.from("task_dependencies").delete().eq("id", id);
    setDeps(deps.filter((d) => d.id !== id));
  }

  async function deleteTask() {
    if (!t || !confirm("Delete this task?")) return;
    const { error } = await postgres.from("tasks").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    toast.success("Task deleted");
    onOpenChange(false);
    onChanged();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            {projectKey}-{t.number}
          </div>
          <SheetTitle>
            <Input
              value={t.title}
              onChange={(e) => setT({ ...t, title: e.target.value })}
              onBlur={(e) => patch({ title: e.target.value })}
              className="border-0 px-0 text-lg font-semibold focus-visible:ring-0"
            />
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <Sel label="Status" value={t.status} onChange={(v) => patch({ status: v as never })}
              options={TASK_STATUSES.map((s) => ({ value: s.value, label: s.label }))} />
            <Sel label="Priority" value={t.priority} onChange={(v) => patch({ priority: v as never })}
              options={TASK_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))} />
            <FieldL label="Assignee"><MemberCombobox members={members} value={t.assignee_id ?? "none"} onChange={(v) => patch({ assignee_id: v === "none" ? null : v })} /></FieldL>
            <FieldL label="Due date">
              <Input type="date" value={t.due_date ? t.due_date.slice(0, 10) : ""}
                onChange={(e) => patch({ due_date: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </FieldL>
            <FieldL label="Story points">
              <Input type="number" step="0.5" min="0" value={t.story_points ?? ""}
                onChange={(e) => setT({ ...t, story_points: e.target.value ? Number(e.target.value) : null })}
                onBlur={(e) => patch({ story_points: e.target.value ? Number(e.target.value) : null })} />
            </FieldL>
            <FieldL label="Estimate (hrs)">
              <Input type="number" step="0.25" min="0"
                value={t.time_estimate_minutes != null ? t.time_estimate_minutes / 60 : ""}
                onChange={(e) => setT({ ...t, time_estimate_minutes: e.target.value ? Math.round(Number(e.target.value) * 60) : null })}
                onBlur={(e) => patch({ time_estimate_minutes: e.target.value ? Math.round(Number(e.target.value) * 60) : null })} />
            </FieldL>
            <FieldL label="Time logged (hrs)">
              <Input type="number" step="0.25" min="0" value={t.time_logged_minutes / 60}
                onChange={(e) => setT({ ...t, time_logged_minutes: Math.round(Number(e.target.value) * 60) })}
                onBlur={(e) => patch({ time_logged_minutes: Math.round(Number(e.target.value || 0) * 60) })} />
            </FieldL>
          </div>

          <FieldL label="Description">
            <Textarea rows={4} value={t.description ?? ""}
              onChange={(e) => setT({ ...t, description: e.target.value })}
              onBlur={(e) => patch({ description: e.target.value || null })} />
          </FieldL>

          <div>
            <Label className="text-xs font-medium text-muted-foreground">Labels</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {labels.length === 0 && <p className="text-xs text-muted-foreground">No workspace labels yet. Create them in Settings.</p>}
              {labels.map((l) => {
                const on = taskLabels.includes(l.id);
                return (
                  <button key={l.id} type="button" onClick={() => toggleLabel(l.id)}
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${on ? "border-transparent" : "border-border/60 text-muted-foreground"}`}
                    style={on ? { backgroundColor: `${l.color}33`, color: l.color, borderColor: `${l.color}66` } : undefined}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: l.color }} />
                    {l.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">Subtasks</Label>
              <NewTaskDialog
                projectId={t.project_id}
                parentTaskId={t.id}
                onCreated={async () => {
                  const { data } = await postgres.from("tasks").select("*").eq("parent_task_id", t.id).order("number");
                  setSubtasks(data ?? []);
                  onChanged();
                }}
                trigger={<Button variant="ghost" size="sm" className="h-7 gap-1"><Plus className="h-3 w-3" />Add</Button>}
              />
            </div>
            <div className="mt-2 space-y-1">
              {subtasks.length === 0 && <p className="text-xs text-muted-foreground">No subtasks</p>}
              {subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-md border border-border/60 bg-card/30 px-2 py-1.5 text-sm">
                  <span className="font-mono text-[10px] text-muted-foreground">{projectKey}-{s.number}</span>
                  <span className="flex-1 truncate">{s.title}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">{s.status.replace("_", " ")}</Badge>
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs font-medium text-muted-foreground">Blocked by</Label>
            <div className="mt-2 space-y-1">
              {deps.length === 0 && <p className="text-xs text-muted-foreground">No dependencies</p>}
              {deps.map((d) => (
                <div key={d.id} className="flex items-center gap-2 rounded-md border border-border/60 bg-card/30 px-2 py-1.5 text-sm">
                  <Link2 className="h-3 w-3 text-muted-foreground" />
                  <span className="font-mono text-[10px] text-muted-foreground">{projectKey}-{d.depends_on.number}</span>
                  <span className="flex-1 truncate">{d.depends_on.title}</span>
                  <button onClick={() => removeDep(d.id)} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                </div>
              ))}
              <div className="flex gap-2">
                <Select value={addingDep} onValueChange={setAddingDep}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Add dependency…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select a task…</SelectItem>
                    {allProjectTasks.map((x) => (
                      <SelectItem key={x.id} value={x.id}>{projectKey}-{x.number} — {x.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" disabled={addingDep === "none"} onClick={addDep}>Add</Button>
              </div>
            </div>
          </div>

          <div className="border-t border-border/60 pt-4">
            <TaskCommentsActivity taskId={t.id} />
          </div>

          <div className="border-t border-border/60 pt-4">
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={deleteTask}>
              <Trash2 className="h-4 w-4" />Delete task
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FieldL({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Sel({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <FieldL label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </FieldL>
  );
}
