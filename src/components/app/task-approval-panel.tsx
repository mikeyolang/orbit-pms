import { useCallback, useEffect, useState } from "react";
import { postgres } from "@/integrations/postgres/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

interface ApprovalTask {
  id: string;
  title: string;
  approval_state: "pending_creation" | "pending_completion";
  project: { name: string; key: string } | null;
}

export function TaskApprovalPanel({ orgId }: { orgId: string }) {
  const [tasks, setTasks] = useState<ApprovalTask[] | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: projects } = await postgres.from("projects").select("id").eq("organization_id", orgId);
    const ids = (projects ?? []).map((project) => project.id);
    if (!ids.length) return setTasks([]);
    const { data } = await postgres.from("tasks").select("id,title,approval_state,project:projects(name,key)").in("project_id", ids).in("approval_state", ["pending_creation", "pending_completion"]).order("created_at");
    setTasks((data as unknown as ApprovalTask[]) ?? []);
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  async function decide(task: ApprovalTask, approve: boolean) {
    const reason = approve ? null : window.prompt("Optional reason for rejecting this request:")?.trim() || null;
    setWorking(task.id);
    const { error } = await postgres.rpc("decide_task_approval", { _task: task.id, _approve: approve, _reason: reason });
    setWorking(null);
    if (error) return toast.error(error.message);
    toast.success(approve ? "Task approved" : "Task rejected");
    await load();
  }

  return <section className="rounded-xl border border-border bg-card p-6">
    <h2 className="text-sm font-semibold">Pending approvals</h2>
    <p className="mt-1 text-xs text-muted-foreground">Review tasks submitted for publishing or completion.</p>
    {tasks === null ? <Loader2 className="mt-4 h-4 w-4 animate-spin" /> : tasks.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No task approvals are waiting.</p> : <div className="mt-4 divide-y rounded-lg border">
      {tasks.map((task) => <div key={task.id} className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{task.title}</div><div className="text-xs text-muted-foreground">{task.project?.name ?? "Project"}</div></div>
        <Badge variant="outline">{task.approval_state === "pending_creation" ? "New task" : "Completion"}</Badge>
        <Button size="sm" variant="outline" disabled={working === task.id} onClick={() => decide(task, false)}><X className="h-4 w-4" /> Reject</Button>
        <Button size="sm" disabled={working === task.id} onClick={() => decide(task, true)}><Check className="h-4 w-4" /> Approve</Button>
      </div>)}
    </div>}
  </section>;
}
