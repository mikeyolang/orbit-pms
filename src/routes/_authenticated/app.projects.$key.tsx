import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { postgres } from "@/integrations/postgres/client";
import { useOrg } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label as L } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ChevronRight, Loader2, Plus, Target, Zap } from "lucide-react";
import { NewTaskDialog } from "@/components/app/new-task-dialog";
import { TaskDetailSheet } from "@/components/app/task-detail-sheet";
import { KanbanBoard } from "@/components/app/kanban-board";
import { SprintBoard } from "@/components/app/sprint-board";
import { toast } from "sonner";
import {
  TASK_PRIORITIES, TASK_STATUSES,
  type Milestone, type Project, type Sprint, type Task,
} from "@/lib/projects";

export const Route = createFileRoute("/_authenticated/app/projects/$key")({
  validateSearch: z.object({ task: z.string().uuid().optional() }),
  component: ProjectDetail,
});

function ProjectDetail() {
  const { key } = Route.useParams();
  const { task: linkedTaskId } = Route.useSearch();
  const { currentOrg } = useOrg();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const openedLinkedTask = useRef<string | null>(null);

  const load = useCallback(async () => {
    const { data: p } = await postgres
      .from("projects").select("*")
      .eq("organization_id", currentOrg.organization_id).eq("key", key).maybeSingle();
    if (!p) { setProject(null); return; }
    setProject(p);
    const [{ data: t }, { data: s }, { data: m }] = await Promise.all([
      postgres.from("tasks").select("*").eq("project_id", p.id).order("number", { ascending: false }),
      postgres.from("sprints").select("*").eq("project_id", p.id).order("start_date", { ascending: false, nullsFirst: false }),
      postgres.from("milestones").select("*").eq("project_id", p.id).order("position"),
    ]);
    setTasks(t ?? []);
    setSprints(s ?? []);
    setMilestones(m ?? []);
  }, [currentOrg.organization_id, key]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!linkedTaskId || openedLinkedTask.current === linkedTaskId || tasks.length === 0) return;
    const linkedTask = tasks.find((task) => task.id === linkedTaskId);
    if (!linkedTask) return;
    openedLinkedTask.current = linkedTaskId;
    setActiveTask(linkedTask);
    setSheetOpen(true);
  }, [linkedTaskId, tasks]);

  // Realtime: refresh tasks for this project on any insert/update/delete
  useEffect(() => {
    if (!project?.id) return;
    const channel = postgres
      .channel(`project-${project.id}-tasks`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `project_id=eq.${project.id}` },
        () => load(),
      )
      .subscribe();
    return () => { postgres.removeChannel(channel); };
  }, [project?.id, load]);

  if (project === undefined) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (project === null) return (
    <div className="mx-auto max-w-3xl px-8 py-20 text-center">
      <h2 className="text-lg font-medium">Project not found</h2>
      <Button variant="ghost" className="mt-4" onClick={() => navigate({ to: "/app/projects" })}><ArrowLeft className="h-4 w-4" />Back to projects</Button>
    </div>
  );

  const rootTasks = tasks.filter((t) => !t.parent_task_id);
  const stats = TASK_STATUSES.map((s) => ({ ...s, count: rootTasks.filter((t) => t.status === s.value).length }));
  const statStyles = [
    "border-slate-200 bg-gradient-to-br from-slate-600 to-slate-700 shadow-slate-500/15",
    "border-cyan-400 bg-gradient-to-br from-cyan-500 to-cyan-600 shadow-cyan-500/15",
    "border-blue-400 bg-gradient-to-br from-blue-500 to-indigo-600 shadow-blue-500/15",
    "border-violet-400 bg-gradient-to-br from-violet-500 to-purple-600 shadow-violet-500/15",
    "border-emerald-400 bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/15",
    "border-rose-400 bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-500/15",
  ];

  return (
    <div className="mx-auto max-w-7xl px-8 py-6">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Link to="/app/projects" className="hover:text-foreground">Projects</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-mono">{project.key}</span>
      </div>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="h-8 w-8 rounded-md" style={{ backgroundColor: project.color }} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
            {project.description && <p className="mt-0.5 text-sm text-muted-foreground">{project.description}</p>}
          </div>
        </div>
        <NewTaskDialog projectId={project.id} onCreated={load} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-6">
        {stats.map((s, index) => (
          <div key={s.value} className={`relative overflow-hidden rounded-xl border px-3 py-3 text-white shadow-md transition-transform hover:-translate-y-0.5 ${statStyles[index]}`}>
            <div className="absolute -right-3 -top-5 h-14 w-14 rounded-full bg-white/10" />
            <div className="relative text-[10px] font-semibold uppercase tracking-wider text-white/80">{s.label}</div>
            <div className="relative mt-1 text-2xl font-bold">{s.count}</div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="board" className="mt-6">
        <TabsList>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="sprint">Sprint board</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="sprints">Sprints</TabsTrigger>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-4">
          <KanbanBoard tasks={rootTasks} projectKey={project.key} projectId={project.id} onOpen={(t) => { setActiveTask(t); setSheetOpen(true); }} onChanged={load} />
        </TabsContent>

        <TabsContent value="sprint" className="mt-4">
          <SprintBoard sprints={sprints} tasks={rootTasks} projectKey={project.key} onOpen={(t) => { setActiveTask(t); setSheetOpen(true); }} onChanged={load} />
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <TaskTable tasks={rootTasks} projectKey={project.key} onOpen={(t) => { setActiveTask(t); setSheetOpen(true); }} onChanged={load} />
        </TabsContent>

        <TabsContent value="sprints" className="mt-4">
          <SprintsTab projectId={project.id} sprints={sprints} milestones={milestones} onChanged={load} tasks={rootTasks} projectKey={project.key} />
        </TabsContent>

        <TabsContent value="milestones" className="mt-4">
          <MilestonesTab projectId={project.id} milestones={milestones} sprints={sprints} onChanged={load} tasks={rootTasks} projectKey={project.key} />
        </TabsContent>
      </Tabs>

      <TaskDetailSheet
        task={activeTask} open={sheetOpen} onOpenChange={setSheetOpen}
        projectKey={project.key} onChanged={load}
      />
    </div>
  );
}

// ---------- Tasks ----------
function TaskTable({ tasks, projectKey, onOpen, onChanged }: {
  tasks: Task[]; projectKey: string; onOpen: (t: Task) => void; onChanged: () => void;
}) {
  async function quickUpdate(id: string, patch: Partial<Task>) {
    const { error } = await postgres.from("tasks").update(patch).eq("id", id);
    if (error) toast.error(error.message);
    onChanged();
  }
  if (tasks.length === 0) return (
    <div className="rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center text-sm text-muted-foreground">
      No tasks yet. Use “New task” to add one.
    </div>
  );
  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="w-20 px-3 py-2 text-left">ID</th>
            <th className="px-3 py-2 text-left">Title</th>
            <th className="w-40 px-3 py-2 text-left">Status</th>
            <th className="w-32 px-3 py-2 text-left">Priority</th>
            <th className="w-24 px-3 py-2 text-left">Points</th>
            <th className="w-32 px-3 py-2 text-left">Due</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const overdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== "done" && t.status !== "cancelled";
            return (
              <tr key={t.id} className="cursor-pointer border-t border-border/60 hover:bg-muted/20">
                <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground" onClick={() => onOpen(t)}>{projectKey}-{t.number}</td>
                <td className="px-3 py-2" onClick={() => onOpen(t)}>{t.title}</td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <Select value={t.status} onValueChange={(v) => quickUpdate(t.id, { status: v as never })}>
                    <SelectTrigger className="h-7 border-0 bg-transparent px-2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TASK_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <Select value={t.priority} onValueChange={(v) => quickUpdate(t.id, { priority: v as never })}>
                    <SelectTrigger className="h-7 border-0 bg-transparent px-2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TASK_PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2 text-muted-foreground" onClick={() => onOpen(t)}>{t.story_points ?? "—"}</td>
                <td className={`px-3 py-2 ${overdue ? "text-red-400" : "text-muted-foreground"}`} onClick={() => onOpen(t)}>
                  {t.due_date ? new Date(t.due_date).toLocaleDateString() : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Sprints ----------
function SprintsTab({ projectId, sprints, milestones, onChanged, tasks, projectKey }: {
  projectId: string; sprints: Sprint[]; milestones: Milestone[]; onChanged: () => void; tasks: Task[]; projectKey: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <NewSprintDialog projectId={projectId} milestones={milestones} onCreated={onChanged} />
      </div>
      {sprints.length === 0 && <Empty icon={<Zap className="h-7 w-7 text-muted-foreground" />} text="No sprints yet" />}
      {sprints.map((s) => {
        const items = tasks.filter((t) => t.sprint_id === s.id);
        const done = items.filter((t) => t.status === "done").length;
        return (
          <div key={s.id} className="rounded-xl border border-border/60 bg-card/30 p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium">{s.name}</h3>
                  <Badge variant="outline" className="text-[10px] capitalize">{s.status}</Badge>
                </div>
                {s.goal && <p className="mt-1 text-xs text-muted-foreground">{s.goal}</p>}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {s.start_date ? new Date(s.start_date).toLocaleDateString() : "TBD"} → {s.end_date ? new Date(s.end_date).toLocaleDateString() : "TBD"}
                  &nbsp;•&nbsp;{done}/{items.length} done
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">Milestone</span>
                  <Select value={s.milestone_id ?? "none"} onValueChange={async (value) => {
                    const { error } = await postgres.from("sprints").update({ milestone_id: value === "none" ? null : value }).eq("id", s.id);
                    if (error) toast.error(error.message); else onChanged();
                  }}>
                    <SelectTrigger className="h-7 w-48"><SelectValue placeholder="No milestone" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">No milestone</SelectItem>{milestones.map((milestone) => <SelectItem key={milestone.id} value={milestone.id}>{milestone.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <Select value={s.status} onValueChange={async (v) => {
                await postgres.from("sprints").update({ status: v as never }).eq("id", s.id);
                onChanged();
              }}>
                <SelectTrigger className="h-7 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Planned</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {items.length > 0 && (
              <ul className="mt-3 space-y-1">
                {items.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/30">
                    <span className="font-mono text-[10px] text-muted-foreground">{projectKey}-{t.number}</span>
                    <span className="flex-1 truncate">{t.title}</span>
                    <Badge variant="outline" className="text-[10px] capitalize">{t.status.replace("_", " ")}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NewSprintDialog({ projectId, milestones, onCreated }: { projectId: string; milestones: Milestone[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(""); const [goal, setGoal] = useState("");
  const [start, setStart] = useState(""); const [end, setEnd] = useState("");
  const [milestoneId, setMilestoneId] = useState("none");
  const [loading, setLoading] = useState(false);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return toast.error("Name is required");
    setLoading(true);
    const { data: u } = await postgres.auth.getUser();
    if (!u.user) { setLoading(false); return; }
    const { error } = await postgres.from("sprints").insert({
      project_id: projectId, name: name.trim(), goal: goal.trim() || null,
      start_date: start || null, end_date: end || null, milestone_id: milestoneId === "none" ? null : milestoneId, created_by: u.user.id,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Sprint created");
    setOpen(false); setName(""); setGoal(""); setStart(""); setEnd(""); setMilestoneId("none");
    onCreated();
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="h-4 w-4" />New sprint</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New sprint</DialogTitle></DialogHeader>
        <form onSubmit={create} className="space-y-3">
          <F label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></F>
          <F label="Goal"><Textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} /></F>
          <F label="Milestone"><Select value={milestoneId} onValueChange={setMilestoneId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No milestone</SelectItem>{milestones.map((milestone) => <SelectItem key={milestone.id} value={milestone.id}>{milestone.name}</SelectItem>)}</SelectContent></Select></F>
          <div className="grid grid-cols-2 gap-3">
            <F label="Start"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></F>
            <F label="End"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></F>
          </div>
          <DialogFooter><Button type="submit" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Milestones ----------
function MilestonesTab({ projectId, milestones, sprints, onChanged, tasks, projectKey }: {
  projectId: string; milestones: Milestone[]; sprints: Sprint[]; onChanged: () => void; tasks: Task[]; projectKey: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <NewMilestoneDialog projectId={projectId} onCreated={onChanged} />
      </div>
      {milestones.length === 0 && <Empty icon={<Target className="h-7 w-7 text-muted-foreground" />} text="No milestones yet" />}
      {milestones.map((m) => {
        const linkedSprints = sprints.filter((sprint) => sprint.milestone_id === m.id);
        const linkedSprintIds = new Set(linkedSprints.map((sprint) => sprint.id));
        const items = tasks.filter((t) => t.milestone_id === m.id || (t.sprint_id && linkedSprintIds.has(t.sprint_id)));
        const done = items.filter((t) => t.status === "done").length;
        const completedSprints = linkedSprints.filter((sprint) => sprint.status === "completed").length;
        const sprintProgress = linkedSprints.map((sprint) => {
          if (sprint.status === "completed") return 100;
          const sprintTasks = tasks.filter((task) => task.sprint_id === sprint.id);
          return sprintTasks.length ? Math.round((sprintTasks.filter((task) => task.status === "done").length / sprintTasks.length) * 100) : 0;
        });
        const directTasks = tasks.filter((task) => task.milestone_id === m.id && (!task.sprint_id || !linkedSprintIds.has(task.sprint_id)));
        const progressUnits = [...sprintProgress, ...directTasks.map((task) => task.status === "done" ? 100 : 0)];
        const pct = m.status === "completed" ? 100 : progressUnits.length ? Math.round(progressUnits.reduce((sum, value) => sum + value, 0) / progressUnits.length) : 0;
        return (
          <div key={m.id} className="rounded-xl border border-border/60 bg-card/30 p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-medium">{m.name}</h3>
                  <Badge variant="outline" className="text-[10px] capitalize">{m.status.replace("_", " ")}</Badge>
                </div>
                {m.description && <p className="mt-1 text-xs text-muted-foreground">{m.description}</p>}
                <p className="mt-1 text-[11px] text-muted-foreground">Due {m.due_date ? new Date(m.due_date).toLocaleDateString() : "TBD"} • {done}/{items.length} tasks done{linkedSprints.length ? ` • ${completedSprints}/${linkedSprints.length} sprints complete` : ""}</p>
              </div>
              <Select value={m.status} onValueChange={async (v) => {
                await postgres.from("milestones").update({ status: v as never }).eq("id", m.id);
                onChanged();
              }}>
                <SelectTrigger className="h-7 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            {items.length > 0 && (
              <ul className="mt-3 space-y-1">
                {items.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/30">
                    <span className="font-mono text-[10px] text-muted-foreground">{projectKey}-{t.number}</span>
                    <span className="flex-1 truncate">{t.title}</span>
                    <Badge variant="outline" className="text-[10px] capitalize">{t.status.replace("_", " ")}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NewMilestoneDialog({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(""); const [desc, setDesc] = useState(""); const [due, setDue] = useState("");
  const [loading, setLoading] = useState(false);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return toast.error("Name is required");
    setLoading(true);
    const { data: u } = await postgres.auth.getUser();
    if (!u.user) { setLoading(false); return; }
    const { error } = await postgres.from("milestones").insert({
      project_id: projectId, name: name.trim(), description: desc.trim() || null,
      due_date: due || null, created_by: u.user.id,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Milestone created");
    setOpen(false); setName(""); setDesc(""); setDue("");
    onCreated();
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="h-4 w-4" />New milestone</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New milestone</DialogTitle></DialogHeader>
        <form onSubmit={create} className="space-y-3">
          <F label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></F>
          <F label="Description"><Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></F>
          <F label="Due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></F>
          <DialogFooter><Button type="submit" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><L className="text-xs font-medium text-muted-foreground">{label}</L>{children}</div>;
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border/60 bg-card/20 px-6 py-12 text-center">
      {icon}
      <p className="mt-2 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
