import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { postgres } from "@/integrations/postgres/client";
import { useOrg } from "@/components/app/app-shell";
import { NewProjectDialog } from "@/components/app/new-project-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { ArrowRight, CalendarDays, CheckCircle2, FolderKanban, Loader2, Plus, Search, Zap } from "lucide-react";
import type { Project } from "@/lib/projects";

type ProjectSummary = {
  totalTasks: number;
  completedTasks: number;
  openTasks: number;
  activeSprints: number;
  milestones: number;
};

const EMPTY_SUMMARY: ProjectSummary = { totalTasks: 0, completedTasks: 0, openTasks: 0, activeSprints: 0, milestones: 0 };

const STATUS_STYLE: Record<Project["status"], string> = {
  planning: "border-slate-500/30 bg-slate-500/10 text-slate-500 dark:text-slate-300",
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  on_hold: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  completed: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  archived: "border-zinc-500/30 bg-zinc-500/10 text-zinc-500 dark:text-zinc-300",
};

export const Route = createFileRoute("/_authenticated/app/projects/")({
  component: ProjectsIndex,
});

function ProjectsIndex() {
  const { currentOrg, role } = useOrg();
  const canCreate = role === "owner" || role === "admin" || role === "manager";
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [summaries, setSummaries] = useState<Record<string, ProjectSummary>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "planning" | "on_hold" | "completed">("all");

  useEffect(() => {
    postgres
      .from("projects")
      .select("*")
      .eq("organization_id", currentOrg.organization_id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .then(async ({ data }) => {
        const nextProjects = (data ?? []) as Project[];
        setProjects(nextProjects);
        if (!nextProjects.length) { setSummaries({}); return; }
        const ids = nextProjects.map((project) => project.id);
        const [{ data: tasks }, { data: sprints }, { data: milestones }] = await Promise.all([
          postgres.from("tasks").select("project_id,status,parent_task_id").in("project_id", ids),
          postgres.from("sprints").select("project_id,status").in("project_id", ids),
          postgres.from("milestones").select("project_id,status").in("project_id", ids),
        ]);
        const next = Object.fromEntries(ids.map((id) => [id, { ...EMPTY_SUMMARY }])) as Record<string, ProjectSummary>;
        for (const task of tasks ?? []) {
          if (task.parent_task_id || !next[task.project_id]) continue;
          next[task.project_id].totalTasks++;
          if (task.status === "done") next[task.project_id].completedTasks++;
          if (!["done", "cancelled"].includes(task.status)) next[task.project_id].openTasks++;
        }
        for (const sprint of sprints ?? []) if (sprint.status === "active" && next[sprint.project_id]) next[sprint.project_id].activeSprints++;
        for (const milestone of milestones ?? []) if (milestone.status !== "cancelled" && next[milestone.project_id]) next[milestone.project_id].milestones++;
        setSummaries(next);
      });
  }, [currentOrg.organization_id]);

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (projects ?? []).filter((project) =>
      (filter === "all" || project.status === filter) &&
      (!query || project.name.toLowerCase().includes(query) || project.key.toLowerCase().includes(query) || project.description?.toLowerCase().includes(query)),
    );
  }, [projects, search, filter]);

  const workspaceTotals = useMemo(() => {
    const values = Object.values(summaries);
    return {
      active: (projects ?? []).filter((project) => project.status === "active").length,
      openTasks: values.reduce((sum, item) => sum + item.openTasks, 0),
      completedTasks: values.reduce((sum, item) => sum + item.completedTasks, 0),
    };
  }, [projects, summaries]);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Plan work and track progress across teams.</p>
        </div>
        {canCreate && <NewProjectDialog />}
      </div>

      {projects === null ? (
        <div className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : projects.length === 0 ? (
        <div className="mt-12 flex flex-col items-center rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-16 text-center">
          <FolderKanban className="h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 text-sm font-medium">No projects yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">Create your first project to start tracking work.</p>
          {canCreate && (
            <div className="mt-5">
              <NewProjectDialog trigger={<Button size="sm"><Plus className="h-4 w-4" />Create project</Button>} />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <SummaryCard label="Active projects" value={workspaceTotals.active} icon={FolderKanban} />
            <SummaryCard label="Open tasks" value={workspaceTotals.openTasks} icon={Zap} />
            <SummaryCard label="Tasks completed" value={workspaceTotals.completedTasks} icon={CheckCircle2} />
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects by name or key…" className="pl-9" />
            </div>
            <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
              {(["all", "active", "planning", "on_hold", "completed"] as const).map((value) => (
                <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${filter === value ? "bg-[#1B3673] text-white shadow-sm" : "text-muted-foreground hover:bg-background/70 hover:text-foreground"}`}>
                  {value.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          {visibleProjects.length === 0 ? <div className="mt-8 rounded-xl border border-dashed border-border/60 py-14 text-center text-sm text-muted-foreground">No projects match your search or filter.</div> : <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleProjects.map((p) => {
            const summary = summaries[p.id] ?? EMPTY_SUMMARY;
            const progress = summary.totalTasks ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0;
            return (
            <Link
              key={p.id}
              to="/app/projects/$key"
              params={{ key: p.key }}
              className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg"
            >
              <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: p.color }} />
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-lg text-xs font-bold text-white shadow-sm" style={{ backgroundColor: p.color }}>{p.key.slice(0, 2)}</span>
                <div><div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{p.key}</div><h3 className="line-clamp-1 text-base font-semibold">{p.name}</h3></div>
                <Badge variant="outline" className={`ml-auto text-[10px] capitalize ${STATUS_STYLE[p.status]}`}>{p.status.replace("_", " ")}</Badge>
              </div>
              <p className="mt-4 min-h-10 line-clamp-2 text-sm leading-5 text-muted-foreground">{p.description || "No project description yet."}</p>
              <div className="mt-5 flex items-center justify-between text-xs"><span className="font-medium">Task progress</span><span className="font-semibold">{progress}%</span></div>
              <Progress value={progress} className="mt-2 h-1.5" />
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/60 pt-4 text-center">
                <Metric value={summary.openTasks} label="Open" />
                <Metric value={summary.activeSprints} label="Sprints" />
                <Metric value={summary.milestones} label="Milestones" />
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{p.end_date ? `Due ${new Date(p.end_date).toLocaleDateString()}` : "No due date"}</span>
                <span className="flex items-center gap-1 font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">Open <ArrowRight className="h-3.5 w-3.5" /></span>
              </div>
            </Link>
          );})}
        </div>}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof FolderKanban }) {
  return <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm"><div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div><div><div className="text-xl font-semibold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div></div>;
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div><div className="text-sm font-semibold">{value}</div><div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div></div>;
}
