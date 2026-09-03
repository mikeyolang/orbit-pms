import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { TASK_PRIORITIES, TASK_STATUSES, type Milestone, type Sprint } from "@/lib/projects";

interface Member { user_id: string; full_name: string | null; email: string | null }

export function NewTaskDialog({
  projectId, onCreated, trigger, parentTaskId, defaultStatus, teamId,
}: {
  projectId: string;
  onCreated?: () => void;
  trigger?: React.ReactNode;
  parentTaskId?: string;
  defaultStatus?: string;
  teamId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<string>(defaultStatus ?? "todo");
  const [priority, setPriority] = useState<string>("medium");
  const [assigneeId, setAssigneeId] = useState<string>("none");
  const [sprintId, setSprintId] = useState<string>("none");
  const [milestoneId, setMilestoneId] = useState<string>("none");
  const [points, setPoints] = useState("");
  const [estimateHours, setEstimateHours] = useState("");
  const [dueDate, setDueDate] = useState("");

  useEffect(() => {
    if (open && defaultStatus) setStatus(defaultStatus);
  }, [open, defaultStatus]);

  const [members, setMembers] = useState<Member[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: project } = await supabase.from("projects").select("organization_id").eq("id", projectId).single();
      if (!project) return;
      const [{ data: mems }, { data: sp }, { data: ms }] = await Promise.all([
        supabase.from("organization_members").select("user_id").eq("organization_id", project.organization_id),
        supabase.from("sprints").select("*").eq("project_id", projectId).neq("status", "completed").order("start_date"),
        supabase.from("milestones").select("*").eq("project_id", projectId).neq("status", "completed").order("due_date"),
      ]);
      const ids = (mems ?? []).map((m) => m.user_id);
      const { data: profiles } = ids.length
        ? await supabase.from("profiles").select("id, full_name, email").in("id", ids)
        : { data: [] as { id: string; full_name: string | null; email: string }[] };
      setMembers((profiles ?? []).map((p) => ({ user_id: p.id, full_name: p.full_name, email: p.email })));
      setSprints(sp ?? []);
      setMilestones(ms ?? []);
    })();
  }, [open, projectId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.object({ title: z.string().trim().min(2).max(160) }).safeParse({ title });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);

    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setLoading(false); return; }
    const { error } = await supabase.from("tasks").insert({
      project_id: projectId,
      title: parsed.data.title,
      description: description.trim() || null,
      status: status as never,
      priority: priority as never,
      assignee_id: assigneeId === "none" ? null : assigneeId,
      reporter_id: u.user.id,
      sprint_id: sprintId === "none" ? null : sprintId,
      milestone_id: milestoneId === "none" ? null : milestoneId,
      parent_task_id: parentTaskId ?? null,
      team_id: teamId ?? null,
      story_points: points ? Number(points) : null,
      time_estimate_minutes: estimateHours ? Math.round(Number(estimateHours) * 60) : null,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
      created_by: u.user.id,
      number: 0,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Task created");
    setOpen(false);
    setTitle(""); setDescription(""); setPoints(""); setEstimateHours(""); setDueDate("");
    setAssigneeId("none"); setSprintId("none"); setMilestoneId("none");
    setStatus(defaultStatus ?? "todo");
    onCreated?.();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm"><Plus className="h-4 w-4" />New task</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{parentTaskId ? "New subtask" : "New task"}</DialogTitle></DialogHeader>
        <form onSubmit={create} className="space-y-3">
          <F label="Title"><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} required /></F>
          <F label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></F>
          <div className="grid grid-cols-2 gap-3">
            <F label="Status">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </F>
            <F label="Priority">
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </F>
            <F label="Assignee">
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.full_name ?? m.email ?? "Unknown"}</SelectItem>)}
                </SelectContent>
              </Select>
            </F>
            <F label="Due date">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </F>
            <F label="Sprint">
              <SprintSelect
                projectId={projectId}
                value={sprintId}
                onChange={setSprintId}
                sprints={sprints}
                onCreated={(s) => { setSprints((prev) => [...prev, s]); setSprintId(s.id); }}
              />
            </F>
            <F label="Milestone">
              <MilestoneSelect
                projectId={projectId}
                value={milestoneId}
                onChange={setMilestoneId}
                milestones={milestones}
                onCreated={(m) => { setMilestones((prev) => [...prev, m]); setMilestoneId(m.id); }}
              />
            </F>

            <F label="Story points">
              <Input type="number" step="0.5" min="0" value={points} onChange={(e) => setPoints(e.target.value)} placeholder="e.g. 3" />
            </F>
            <F label="Estimate (hours)">
              <Input type="number" step="0.25" min="0" value={estimateHours} onChange={(e) => setEstimateHours(e.target.value)} placeholder="e.g. 4" />
            </F>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SprintSelect({
  projectId, value, onChange, sprints, onCreated,
}: {
  projectId: string;
  value: string;
  onChange: (v: string) => void;
  sprints: Sprint[];
  onCreated: (s: Sprint) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (name.trim().length < 2) return;
    setBusy(true);
    const { data, error } = await supabase.from("sprints").insert({
      project_id: projectId, name: name.trim(), status: "planned",
      start_date: new Date().toISOString().slice(0, 10),
      end_date: new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10),
    } as never).select().single();
    setBusy(false);
    if (error) return toast.error(error.message);
    onCreated(data as Sprint);
    setName(""); setCreating(false);
  }

  if (creating) {
    return (
      <div className="flex gap-1">
        <Input autoFocus placeholder="Sprint name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="button" size="sm" onClick={save} disabled={busy}>Add</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
      </div>
    );
  }

  return (
    <Select value={value} onValueChange={(v) => v === "__new__" ? setCreating(true) : onChange(v)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No sprint</SelectItem>
        {sprints.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
        <SelectItem value="__new__" className="text-primary">+ Create sprint…</SelectItem>
      </SelectContent>
    </Select>
  );
}

function MilestoneSelect({
  projectId, value, onChange, milestones, onCreated,
}: {
  projectId: string;
  value: string;
  onChange: (v: string) => void;
  milestones: Milestone[];
  onCreated: (m: Milestone) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (name.trim().length < 2) return;
    setBusy(true);
    const { data, error } = await supabase.from("milestones").insert({
      project_id: projectId, name: name.trim(), status: "upcoming",
    } as never).select().single();
    setBusy(false);
    if (error) return toast.error(error.message);
    onCreated(data as Milestone);
    setName(""); setCreating(false);
  }

  if (creating) {
    return (
      <div className="flex gap-1">
        <Input autoFocus placeholder="Milestone name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="button" size="sm" onClick={save} disabled={busy}>Add</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
      </div>
    );
  }

  return (
    <Select value={value} onValueChange={(v) => v === "__new__" ? setCreating(true) : onChange(v)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No milestone</SelectItem>
        {milestones.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
        <SelectItem value="__new__" className="text-primary">+ Create milestone…</SelectItem>
      </SelectContent>
    </Select>
  );
}

