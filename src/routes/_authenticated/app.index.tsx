import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  CircleDot,
  Clock3,
  Flame,
  FolderKanban,
  Gauge,
  ListChecks,
  Radio,
  Play,
  Settings2,
  ShieldAlert,
  Sparkles,
  Target,
  Timer,
  StopCircle,
  TrendingUp,
  Users,
} from "lucide-react";
import { postgres } from "@/integrations/postgres/client";
import { useOrg } from "@/components/app/app-shell";
import { NewProjectDialog } from "@/components/app/new-project-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { TASK_PRIORITIES, TASK_STATUSES, type Milestone, type Project, type Sprint, type Task } from "@/lib/projects";
import type { OrgRole } from "@/lib/auth";
import { EndShiftDialog } from "@/components/shifts/end-shift-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/")({
  component: Dashboard,
});

type MemberRow = {
  user_id: string;
  role: OrgRole;
  profile: { full_name: string | null; email: string | null } | null;
};

type MemberBaseRow = {
  user_id: string;
  role: OrgRole;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type DashboardData = {
  projects: Project[];
  tasks: Task[];
  sprints: Sprint[];
  milestones: Milestone[];
  members: MemberRow[];
  currentUserId: string | null;
};

type ProjectHealth = {
  project: Project;
  total: number;
  open: number;
  done: number;
  overdue: number;
  dueSoon: number;
  urgent: number;
  progress: number;
  health: "on_track" | "watch" | "at_risk" | "paused" | "complete";
};

const EMPTY_DATA: DashboardData = {
  projects: [],
  tasks: [],
  sprints: [],
  milestones: [],
  members: [],
  currentUserId: null,
};

const statusColorMap = Object.fromEntries(
  TASK_STATUSES.map((status) => [status.value, status.color]),
) as Record<Task["status"], string>;

const priorityColorMap = Object.fromEntries(
  TASK_PRIORITIES.map((priority) => [priority.value, priority.color]),
) as Record<Task["priority"], string>;

const trendChartConfig = {
  created: { label: "Created", color: "#60a5fa" },
  completed: { label: "Completed", color: "#34d399" },
} satisfies ChartConfig;

const statusChartConfig = {
  count: { label: "Tasks", color: "#8b5cf6" },
} satisfies ChartConfig;

const priorityChartConfig = {
  value: { label: "Tasks", color: "#f59e0b" },
} satisfies ChartConfig;

const STATUS_COLORS: Record<Task["status"], string> = {
  backlog: "#64748b",
  todo: "#94a3b8",
  in_progress: "#60a5fa",
  in_review: "#c084fc",
  done: "#34d399",
  cancelled: "#71717a",
};

const PRIORITY_COLORS: Record<Task["priority"], string> = {
  low: "#94a3b8",
  medium: "#60a5fa",
  high: "#f59e0b",
  urgent: "#f87171",
};

const ALL_WIDGETS: { id: WidgetId; label: string; group: "Overview" | "Charts" | "Delivery" | "Risk" }[] = [
  { id: "metrics", label: "Top metrics", group: "Overview" },
  { id: "signals", label: "Weekly signals", group: "Overview" },
  { id: "kpis", label: "KPI widgets", group: "Overview" },
  { id: "trend", label: "Delivery trend + task distribution", group: "Charts" },
  { id: "health", label: "Project health, workload & priority", group: "Delivery" },
  { id: "sprints", label: "Sprint pulse & action center", group: "Delivery" },
  { id: "missed", label: "Missed deadlines panel", group: "Risk" },
  { id: "milestones", label: "Milestone timeline & my focus", group: "Delivery" },
];

type WidgetId = "metrics" | "signals" | "kpis" | "trend" | "health" | "sprints" | "missed" | "milestones";

function useWidgetPrefs(orgId: string, userId: string | null) {
  const key = `dashboard:${orgId}:${userId ?? "anon"}:widgets`;
  const [hidden, setHidden] = useState<Set<WidgetId>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setHidden(new Set(JSON.parse(raw) as WidgetId[]));
      else setHidden(new Set());
    } catch { setHidden(new Set()); }
  }, [key]);

  const toggle = useCallback((id: WidgetId) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, JSON.stringify(Array.from(next)));
      }
      return next;
    });
  }, [key]);

  const reset = useCallback(() => {
    setHidden(new Set());
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  }, [key]);

  return { hidden, toggle, reset, show: (id: WidgetId) => !hidden.has(id) };
}

function Dashboard() {
  const { currentOrg } = useOrg();
  const shiftOnly = currentOrg.can_access_shifts !== false && currentOrg.can_access_projects === false;
  return shiftOnly ? <ShiftOnlyDashboard /> : <ProjectDashboard />;
}

type PreviousShiftReport = {
  id: string;
  checked_out_at: string;
  total_tickets: number;
  total_value: string;
  cancelled_tickets: number;
  total_chats_received: number;
  total_chats_handled: number;
  total_chats_missed: number;
  handover_notes: string | null;
};
type UpcomingShift = { id: string; start_at: string; end_at: string; status: string; shift_type: { label: string; color: string } | null };

function ShiftOnlyDashboard() {
  const { currentOrg } = useOrg();
  const [reports, setReports] = useState<PreviousShiftReport[] | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingShift[] | null>(null);
  const [endTarget, setEndTarget] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: auth } = await postgres.auth.getUser();
      if (!auth.user) { if (!cancelled) { setReports([]); setUpcoming([]); } return; }
      const [reportResult, shiftResult] = await Promise.all([
        postgres.from("shift_reports").select("id,checked_out_at,total_tickets,total_value,cancelled_tickets,total_chats_received,total_chats_handled,total_chats_missed,handover_notes").eq("organization_id", currentOrg.organization_id).eq("user_id", auth.user.id).order("checked_out_at", { ascending: false }).limit(5),
        postgres.from("shifts").select("id,start_at,end_at,status,shift_type:shift_types(label,color)").eq("organization_id", currentOrg.organization_id).eq("user_id", auth.user.id).gte("end_at", new Date().toISOString()).in("status", ["scheduled", "in_progress"]).order("start_at", { ascending: true }).limit(5),
      ]);
      if (!cancelled) { setReports((reportResult.data as PreviousShiftReport[]) ?? []); setUpcoming((shiftResult.data as unknown as UpcomingShift[]) ?? []); }
    }
    void load();
    return () => { cancelled = true; };
  }, [currentOrg.organization_id, refreshKey]);
  const latestWithNote = reports?.find((report) => report.handover_notes?.trim());
  const totals = (reports ?? []).reduce((sum, report) => ({ tickets: sum.tickets + Number(report.total_tickets), value: sum.value + Number(report.total_value), chats: sum.chats + report.total_chats_handled }), { tickets: 0, value: 0, chats: 0 });
  async function startShift(id: string) {
    const { error } = await postgres.from("shifts").update({ status: "in_progress", started_at: new Date().toISOString() }).eq("id", id).eq("status", "scheduled");
    if (error) return toast.error(error.message);
    toast.success("Shift started");
    setRefreshKey((value) => value + 1);
  }

  return <div className="mx-auto max-w-6xl space-y-6 px-6 py-8 lg:px-8">
    <div><div className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" />Your shift dashboard · {formatDate(new Date().toISOString())}</div><h1 className="mt-2 text-3xl font-semibold tracking-tight">Welcome to {currentOrg.organization.name}</h1><p className="mt-1 text-sm text-muted-foreground">A quick summary of your recently completed shifts.</p></div>
    {reports === null || upcoming === null ? <DashboardLoading /> : <>
      <section className="rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-card to-card p-4 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Upcoming shifts</h2><p className="text-xs text-muted-foreground">Your next scheduled shifts.</p></div><Button asChild size="sm" variant="outline"><Link to="/app/shifts">Open calendar</Link></Button></div>{upcoming.length ? <div className="mt-3 grid gap-3 sm:grid-cols-2">{upcoming.map((shift) => { const ready = shift.status === "scheduled" && new Date(shift.start_at).getTime() <= Date.now() && new Date(shift.end_at).getTime() >= Date.now(); const active = shift.status === "in_progress"; return <div key={shift.id} className={`rounded-xl border p-4 shadow-sm ${active ? "border-emerald-500/40 bg-emerald-500/10" : "border-cyan-500/20 bg-background/65"}`}><div className="flex items-start gap-3"><span className="mt-1 h-3 w-3 rounded-full" style={{ backgroundColor: shift.shift_type?.color ?? "#06b6d4" }} /><div className="min-w-0 flex-1"><div className="font-medium">{shift.shift_type?.label ?? "Shift"}</div><div className="mt-1 text-sm text-muted-foreground">{new Date(shift.start_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div><div className="text-xs text-muted-foreground">Until {new Date(shift.end_at).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" })}</div>{ready && <Button size="sm" className="mt-3 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => void startShift(shift.id)}><Play className="h-4 w-4" />Start shift</Button>}{active && <Button size="sm" className="mt-3 bg-red-600 text-white hover:bg-red-700" onClick={() => setEndTarget(shift.id)}><StopCircle className="h-4 w-4" />End shift</Button>}</div></div></div>; })}</div> : <div className="mt-3 rounded-xl border border-dashed border-cyan-500/25 bg-background/40 p-8 text-center"><CalendarClock className="mx-auto h-6 w-6 text-cyan-600" /><p className="mt-2 text-sm font-medium">No upcoming shifts yet</p><p className="text-xs text-muted-foreground">New assignments will appear here automatically.</p></div>}</section>
      {reports.length ? <><section className="grid gap-3 sm:grid-cols-3"><MetricCard title="Tickets from recent shifts" value={String(totals.tickets)} subtitle={`Across your last ${reports.length} shift${reports.length === 1 ? "" : "s"}`} icon={CheckSquare} tone="blue" /><MetricCard title="Ticket value" value={totals.value.toLocaleString(undefined, { minimumFractionDigits: 2 })} subtitle="From your recent checkouts" icon={TrendingUp} tone="emerald" /><MetricCard title="Chats handled" value={String(totals.chats)} subtitle="From your recent checkouts" icon={Activity} tone="violet" /></section>{latestWithNote?.handover_notes && <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-amber-600">Latest shift note</div><p className="mt-2 text-sm">{latestWithNote.handover_notes}</p><div className="mt-2 text-xs text-muted-foreground">Submitted {formatDate(latestWithNote.checked_out_at)}</div></section>}<section className="rounded-xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-card to-card p-4 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Previous shifts</h2><p className="text-xs text-muted-foreground">Your five most recent completed shift reports.</p></div><Button asChild size="sm" variant="outline"><Link to="/app/shift-reports">View all reports</Link></Button></div><div className="mt-3 divide-y rounded-lg border bg-background/55">{reports.map((report) => <div key={report.id} className="flex items-center justify-between gap-4 p-3 transition-colors hover:bg-indigo-500/5"><div><div className="text-sm font-medium">{formatDate(report.checked_out_at)}</div><div className="text-xs text-muted-foreground">{report.total_tickets} tickets · {Number(report.total_value).toLocaleString(undefined, { minimumFractionDigits: 2 })} · {report.total_chats_handled} chats handled · {report.total_chats_missed} missed</div></div><Button asChild size="sm" variant="ghost"><a href={`/api/shift-report/${report.id}/pdf`} target="_blank" rel="noreferrer">PDF</a></Button></div>)}</div></section></> : <div className="rounded-2xl border border-dashed border-indigo-500/25 bg-gradient-to-br from-indigo-500/10 via-card to-card px-6 py-10 text-center"><Activity className="mx-auto h-8 w-8 text-indigo-500" /><h2 className="mt-3 text-lg font-medium">No completed shift data yet</h2><p className="mt-1 text-sm text-muted-foreground">Your ticket and chat summaries will appear after your first checkout.</p></div>}
    </>}
    {endTarget && <EndShiftDialog open={!!endTarget} onOpenChange={(open) => !open && setEndTarget(null)} shiftId={endTarget} orgId={currentOrg.organization_id} onEnded={() => setRefreshKey((value) => value + 1)} />}
  </div>;
}

function ProjectDashboard() {
  const { currentOrg, role } = useOrg();
  const orgId = currentOrg.organization_id;
  const canManage = role === "owner" || role === "admin";
  const canCreate = canManage || role === "manager";
  const isPersonal = role === "member" || role === "viewer";
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);

  const [live, setLive] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDashboard = useCallback(async () => {
    const { data: userData } = await postgres.auth.getUser();
    const [{ data: projectsData }, { data: membersData }] = await Promise.all([
      postgres
        .from("projects")
        .select("*")
        .eq("organization_id", orgId)
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
      postgres
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", orgId),
    ]);

    const projects = (projectsData ?? []) as Project[];
    const memberRows = (membersData ?? []) as MemberBaseRow[];
    const memberIds = Array.from(new Set(memberRows.map((member) => member.user_id)));
    const { data: profilesData } = memberIds.length > 0
      ? await postgres.from("profiles").select("id, full_name, email").in("id", memberIds)
      : { data: [] as ProfileRow[] };
    const profileById = new Map((profilesData ?? []).map((profile) => [profile.id, profile]));
    const members: MemberRow[] = memberRows.map((member) => ({
      ...member,
      profile: profileById.get(member.user_id) ?? null,
    }));
    const projectIds = projects.map((project) => project.id);
    let tasks: Task[] = [];
    let sprints: Sprint[] = [];
    let milestones: Milestone[] = [];

    if (projectIds.length > 0) {
      const [taskResult, sprintResult, milestoneResult] = await Promise.all([
        postgres
          .from("tasks")
          .select("*")
          .in("project_id", projectIds)
          .order("updated_at", { ascending: false })
          .limit(1000),
        postgres
          .from("sprints")
          .select("*")
          .in("project_id", projectIds)
          .order("start_date", { ascending: true, nullsFirst: false }),
        postgres
          .from("milestones")
          .select("*")
          .in("project_id", projectIds)
          .order("due_date", { ascending: true, nullsFirst: false }),
      ]);
      tasks = (taskResult.data ?? []) as Task[];
      sprints = (sprintResult.data ?? []) as Sprint[];
      milestones = (milestoneResult.data ?? []) as Milestone[];
    }

    setData({
      projects,
      tasks,
      sprints,
      milestones,
      members,
      currentUserId: userData.user?.id ?? null,
    });
    setLastUpdated(new Date());
  }, [orgId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadDashboard().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadDashboard]);

  // Realtime: any change to projects / tasks / sprints / milestones in this org triggers a debounced reload.
  useEffect(() => {
    const scheduleReload = () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        loadDashboard();
      }, 350);
    };
    const channel = postgres
      .channel(`dashboard:${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "sprints" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "milestones" }, scheduleReload)
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      postgres.removeChannel(channel);
    };
  }, [orgId, loadDashboard]);


  // Personal view for members/viewers: scope analytics to tasks assigned to me.
  const scopedData = useMemo<DashboardData>(() => {
    if (!isPersonal || !data.currentUserId) return data;
    return { ...data, tasks: data.tasks.filter((t) => t.assignee_id === data.currentUserId) };
  }, [data, isPersonal]);
  const analytics = useMemo(() => buildAnalytics(scopedData), [scopedData]);

  const widgets = useWidgetPrefs(orgId, data.currentUserId);
  const { show } = widgets;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
      <div className="relative overflow-hidden bg-white p-6 shadow-sm dark:bg-slate-950 lg:p-8">
        <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-indigo-100/60 blur-3xl dark:bg-indigo-500/10" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300">
            <Gauge className="h-3.5 w-3.5" />
            {isPersonal ? "Your personal dashboard" : "Executive command center"} · {formatDate(new Date().toISOString())}
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
            {isPersonal ? "My workspace" : currentOrg.organization.name}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
            {isPersonal
              ? `Your tasks, sprints, and deadlines across ${currentOrg.organization.name}.`
              : "Manager-ready visibility across delivery progress, sprint health, workload, risk, and accountability."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px]",
              live
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                : "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
            )}
            title={lastUpdated ? `Last synced ${lastUpdated.toLocaleTimeString()}` : "Connecting…"}
          >
            <Radio className={cn("h-3 w-3", live && "animate-pulse")} />
            {live ? "Live" : "Offline"}
          </span>
          <Badge variant="outline" className="border-indigo-200 bg-indigo-50 capitalize text-indigo-700 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-200">
            {role} view
          </Badge>
          <WidgetEditor widgets={widgets} />
          {canCreate && <NewProjectDialog />}
        </div>
      </div>
      </div>



      {loading ? (
        <DashboardLoading />
      ) : data.projects.length === 0 ? (
        <EmptyWorkspace canCreate={canCreate} />
      ) : (
        <>
          {show("metrics") && (<section className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Portfolio progress"
              value={`${analytics.progress}%`}
              subtitle={`${analytics.doneTasks}/${analytics.actionableTasks} deliverables completed`}
              icon={TrendingUp}
              tone="emerald"
              progress={analytics.progress}
            />
            <MetricCard
              title="At-risk work"
              value={analytics.atRiskTasks.toString()}
              subtitle={`${analytics.overdueTasks} overdue · ${analytics.urgentTasks} urgent`}
              icon={AlertTriangle}
              tone={analytics.atRiskTasks > 0 ? "red" : "slate"}
            />
            <MetricCard
              title="Active execution"
              value={analytics.activeProjects.toString()}
              subtitle={`${analytics.activeSprints.length} active sprints · ${analytics.openTasks} open tasks`}
              icon={Activity}
              tone="blue"
            />
            <MetricCard
              title="Team capacity"
              value={analytics.membersWithWork.toString()}
              subtitle={`${data.members.length} members · ${analytics.unassignedTasks} unassigned tasks`}
              icon={Users}
              tone={analytics.unassignedTasks > 0 ? "amber" : "violet"}
            />
          </section>)}

          {show("signals") && (<section className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MiniSignal label="Completed this week" value={analytics.completedThisWeek} icon={CheckCircle2} tone="emerald" />
            <MiniSignal label="Created this week" value={analytics.createdThisWeek} icon={ListChecks} tone="blue" />
            <MiniSignal label="Due in 7 days" value={analytics.dueSoonTasks} icon={CalendarDays} tone="amber" />
            <MiniSignal label="Needs review" value={analytics.reviewQueue.length} icon={CircleDot} tone="violet" />
          </section>)}

          {show("kpis") && (<section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiWidget
              title="Active projects"
              value={analytics.activeProjects}
              hint={`${analytics.projectHealth.length} total · ${analytics.atRiskProjects} at risk`}
              icon={FolderKanban}
              tone="blue"
            />
            <KpiWidget
              title="Overall completion rate"
              value={`${analytics.progress}%`}
              hint={`${analytics.doneTasks} of ${analytics.actionableTasks} deliverables done`}
              icon={TrendingUp}
              tone="emerald"
              progress={analytics.progress}
            />
            <KpiWidget
              title="Due today"
              value={analytics.dueTodayCount}
              hint={`${analytics.dueTomorrowCount} due tomorrow · ${analytics.dueSoonTasks} in 7d`}
              icon={CalendarClock}
              tone={analytics.dueTodayCount > 0 ? "amber" : "slate"}
            />
            <KpiWidget
              title="Overdue trend"
              value={analytics.overdueTasks}
              hint={`${analytics.overdueTrendDelta >= 0 ? "+" : ""}${analytics.overdueTrendDelta} vs 7d ago`}
              icon={ShieldAlert}
              tone={analytics.overdueTasks > 0 ? "red" : "emerald"}
              trend={analytics.overdueTrend}
            />
          </section>)}

          {show("trend") && (<section className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
            <Panel
              title="Delivery trend"
              subtitle="Daily task creation vs completion for the last 14 days."
              action={<Badge variant="outline">Velocity {analytics.velocity}/week</Badge>}
            >
              <ChartContainer config={trendChartConfig} className="h-[285px] w-full">
                <AreaChart data={analytics.trendData} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="createdGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-created)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-created)" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="completedGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-completed)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-completed)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="created" stroke="var(--color-created)" fill="url(#createdGradient)" strokeWidth={2} />
                  <Area type="monotone" dataKey="completed" stroke="var(--color-completed)" fill="url(#completedGradient)" strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            </Panel>

            <Panel title="Task distribution" subtitle="Current workflow shape by status.">
              <ChartContainer config={statusChartConfig} className="h-[285px] w-full">
                <BarChart data={analytics.statusData} layout="vertical" margin={{ left: 10, right: 20, top: 8, bottom: 8 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} hide />
                  <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} width={76} />
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {analytics.statusData.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_COLORS[entry.status]} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </Panel>
          </section>)}

          {show("health") && (<section className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr_0.78fr]">
            <Panel
              title="Project health"
              subtitle="Prioritized by delivery risk, overdue work, and completion."
              action={
                <Link to="/app/projects" className="text-xs text-muted-foreground hover:text-foreground">
                  View all <ArrowRight className="ml-1 inline h-3 w-3" />
                </Link>
              }
            >
              <div className="space-y-3">
                {analytics.projectHealth.slice(0, 6).map((item) => (
                  <Link
                    key={item.project.id}
                    to="/app/projects/$key"
                    params={{ key: item.project.key }}
                    className="block rounded-xl border border-blue-500/15 bg-gradient-to-br from-blue-500/10 via-background/70 to-background/40 p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-500/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.project.color }} />
                          <span className="font-mono text-[10px] text-muted-foreground">{item.project.key}</span>
                          <HealthBadge health={item.health} />
                        </div>
                        <h3 className="mt-1 truncate text-sm font-medium">{item.project.name}</h3>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div className="font-medium text-foreground">{item.progress}%</div>
                        <div>{item.done}/{item.total || 0}</div>
                      </div>
                    </div>
                    <Progress value={item.progress} className="mt-3 h-1.5 bg-muted/60" />
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      <span>{item.open} open</span>
                      <span>·</span>
                      <span className={item.overdue ? "text-red-400" : undefined}>{item.overdue} overdue</span>
                      <span>·</span>
                      <span>{item.dueSoon} due soon</span>
                    </div>
                  </Link>
                ))}
              </div>
            </Panel>

            <Panel title="Team workload & accountability" subtitle="Open assignments, overdue ownership, and urgent load.">
              <div className="space-y-3">
                {analytics.workload.length === 0 ? (
                  <EmptyPanel icon={Users} text="No team workload yet." />
                ) : (
                  analytics.workload.map((member) => (
                    <div key={member.userId} className="rounded-xl border border-violet-500/15 bg-gradient-to-br from-violet-500/10 via-background/70 to-background/40 p-3 shadow-sm transition-transform hover:-translate-y-0.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{member.name}</div>
                          <div className="text-xs capitalize text-muted-foreground">{member.role}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold">{member.open}</div>
                          <div className="text-[11px] text-muted-foreground">open</div>
                        </div>
                      </div>
                      <Progress value={member.loadPercent} className="mt-3 h-1.5 bg-muted/60" />
                      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                        <span>{member.completed} done</span>
                        <span className={member.overdue ? "text-red-400" : undefined}>{member.overdue} overdue</span>
                        <span className={member.urgent ? "text-amber-400" : undefined}>{member.urgent} urgent</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Panel>

            <Panel title="Priority exposure" subtitle="How much work is low, medium, high, or urgent.">
              <ChartContainer config={priorityChartConfig} className="mx-auto h-[220px] w-full max-w-[280px]">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Pie data={analytics.priorityData} dataKey="value" nameKey="label" innerRadius={54} outerRadius={86} paddingAngle={3}>
                    {analytics.priorityData.map((entry) => (
                      <Cell key={entry.priority} fill={PRIORITY_COLORS[entry.priority]} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {analytics.priorityData.map((entry) => (
                  <div key={entry.priority} className="rounded-lg border border-amber-500/15 bg-gradient-to-br from-amber-500/10 to-background/50 px-3 py-2 shadow-sm">
                    <div className="flex items-center gap-2 text-xs capitalize">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[entry.priority] }} />
                      {entry.label}
                    </div>
                    <div className="mt-1 text-lg font-semibold">{entry.value}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </section>)}

          {show("sprints") && (<section className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel
              title="Sprint pulse"
              subtitle="Active sprint progress, scope, and remaining points."
              action={<Badge variant="outline">{analytics.activeSprints.length} active</Badge>}
            >
              <div className="space-y-3">
                {analytics.sprintPulse.length === 0 ? (
                  <EmptyPanel icon={Timer} text="No active sprint. Start one from a project sprint board." />
                ) : (
                  analytics.sprintPulse.map((sprint) => (
                    <div key={sprint.id} className="rounded-xl border border-cyan-500/15 bg-gradient-to-br from-cyan-500/10 via-background/70 to-background/40 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{sprint.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{sprint.projectName}</div>
                        </div>
                        <Badge variant="outline">{sprint.progress}% done</Badge>
                      </div>
                      <Progress value={sprint.progress} className="mt-4 h-2 bg-muted/60" />
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                        <span>{sprint.done}/{sprint.total} tasks</span>
                        <span>{sprint.donePoints}/{sprint.totalPoints} pts</span>
                        <span>{sprint.daysLeft} days left</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Panel>

            <Panel title="Manager action center" subtitle="The highest-impact issues to unblock first.">
              <div className="grid gap-3 md:grid-cols-2">
                <ActionList title="Overdue" icon={Flame} tasks={analytics.overdueList} tone="red" />
                <ActionList title="Review queue" icon={CircleDot} tasks={analytics.reviewQueue} tone="violet" />
                <ActionList title="Unassigned" icon={Users} tasks={analytics.unassignedList} tone="amber" />
                <ActionList title="Stale updates" icon={Clock3} tasks={analytics.staleList} tone="slate" />
              </div>
            </Panel>
          </section>)}

          {show("missed") && (<section className="mt-6">
            <Panel
              title="Missed deadlines & overdue activity"
              subtitle="Every open task past its due date — with responsible owner, timestamps, and how late it is."
              action={
                <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-300">
                  {analytics.overdueTasks} overdue
                </Badge>
              }
            >
              <MissedDeadlinePanel items={analytics.missedDeadlines} />
            </Panel>
          </section>)}

          {show("milestones") && (<section className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">

            <Panel title="Milestone timeline" subtitle="Upcoming deliverables and current completion by milestone.">
              <div className="space-y-3">
                {analytics.milestoneTimeline.length === 0 ? (
                  <EmptyPanel icon={Target} text="No milestones planned yet." />
                ) : (
                  analytics.milestoneTimeline.map((milestone) => (
                    <div key={milestone.id} className="rounded-xl border border-indigo-500/15 bg-gradient-to-br from-indigo-500/10 via-background/70 to-background/40 p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{milestone.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{milestone.projectName}</div>
                        </div>
                        <div className={cn("text-right text-xs", milestone.overdue ? "text-red-400" : "text-muted-foreground")}>
                          {milestone.dueLabel}
                        </div>
                      </div>
                      <Progress value={milestone.progress} className="mt-3 h-1.5 bg-muted/60" />
                      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="capitalize">{milestone.status.replace("_", " ")}</span>
                        <span>{milestone.progress}% complete</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Panel>

            <Panel title="My focus" subtitle="Your open tasks ordered by urgency and due date.">
              <div className="space-y-2">
                {analytics.myTasks.length === 0 ? (
                  <EmptyPanel icon={CheckSquare} text="Nothing assigned to you right now." />
                ) : (
                  analytics.myTasks.map((task) => <TaskRow key={task.id} task={task} compact />)
                )}
              </div>
            </Panel>
          </section>)}

          <div className="mt-6 rounded-2xl border border-border/60 bg-gradient-to-r from-primary/10 via-card/50 to-card/20 p-5">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <h3 className="text-sm font-medium">Manager dashboard upgraded</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  This view now summarizes portfolio progress, sprint execution, workload balance, milestone risk, and accountability queues so managers can see where everything stands at a glance.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function buildAnalytics(data: DashboardData) {
  const now = new Date();
  const today = startOfDay(now);
  const weekAgo = addDays(today, -7);
  const actionableTasks = data.tasks.filter((task) => task.status !== "cancelled");
  const doneTasks = actionableTasks.filter((task) => task.status === "done");
  const openTasks = actionableTasks.filter((task) => task.status !== "done");
  const overdueTasks = openTasks.filter((task) => isOverdue(task.due_date, today));
  const dueSoonTasks = openTasks.filter((task) => isDueSoon(task.due_date, today));
  const unassignedTasks = openTasks.filter((task) => !task.assignee_id);
  const urgentTasks = openTasks.filter((task) => task.priority === "urgent");
  const reviewQueue = openTasks.filter((task) => task.status === "in_review").slice(0, 5);
  const staleList = openTasks.filter((task) => daysBetween(new Date(task.updated_at), now) >= 7).slice(0, 5);
  const progress = percentage(doneTasks.length, actionableTasks.length);
  const activeProjects = data.projects.filter((project) => project.status === "active").length;
  const activeSprints = data.sprints.filter((sprint) => sprint.status === "active");
  const completedThisWeek = doneTasks.filter((task) => task.completed_at && new Date(task.completed_at) >= weekAgo).length;
  const createdThisWeek = actionableTasks.filter((task) => new Date(task.created_at) >= weekAgo).length;

  const tasksByProject = new Map<string, Task[]>();
  for (const task of data.tasks) {
    const existing = tasksByProject.get(task.project_id) ?? [];
    existing.push(task);
    tasksByProject.set(task.project_id, existing);
  }

  const projectHealth: ProjectHealth[] = data.projects
    .map((project) => {
      const projectTasks = (tasksByProject.get(project.id) ?? []).filter((task) => task.status !== "cancelled");
      const projectDone = projectTasks.filter((task) => task.status === "done");
      const projectOpen = projectTasks.filter((task) => task.status !== "done");
      const overdue = projectOpen.filter((task) => isOverdue(task.due_date, today)).length;
      const dueSoon = projectOpen.filter((task) => isDueSoon(task.due_date, today)).length;
      const urgent = projectOpen.filter((task) => task.priority === "urgent").length;
      const projectProgress = percentage(projectDone.length, projectTasks.length);
      let health: ProjectHealth["health"] = "on_track";
      if (project.status === "completed") health = "complete";
      else if (project.status === "on_hold") health = "paused";
      else if (overdue > 0 || urgent > 2) health = "at_risk";
      else if (dueSoon > 2 || projectProgress < 35) health = "watch";
      return {
        project,
        total: projectTasks.length,
        open: projectOpen.length,
        done: projectDone.length,
        overdue,
        dueSoon,
        urgent,
        progress: projectProgress,
        health,
      };
    })
    .sort((a, b) => riskScore(b) - riskScore(a));

  const statusData = TASK_STATUSES.map((status) => ({
    status: status.value,
    label: status.label,
    count: data.tasks.filter((task) => task.status === status.value).length,
  }));

  const priorityData = TASK_PRIORITIES.map((priority) => ({
    priority: priority.value,
    label: priority.label,
    value: openTasks.filter((task) => task.priority === priority.value).length,
  }));

  const trendData = Array.from({ length: 14 }, (_, index) => {
    const date = addDays(today, index - 13);
    const end = addDays(date, 1);
    return {
      label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      created: actionableTasks.filter((task) => isWithin(new Date(task.created_at), date, end)).length,
      completed: doneTasks.filter((task) => task.completed_at && isWithin(new Date(task.completed_at), date, end)).length,
    };
  });

  const workload = data.members
    .map((member) => {
      const assigned = data.tasks.filter((task) => task.assignee_id === member.user_id && task.status !== "cancelled");
      const open = assigned.filter((task) => task.status !== "done");
      const completed = assigned.filter((task) => task.status === "done");
      const overdue = open.filter((task) => isOverdue(task.due_date, today));
      const urgent = open.filter((task) => task.priority === "urgent");
      const loadScore = open.length * 2 + overdue.length * 4 + urgent.length * 3;
      return {
        userId: member.user_id,
        role: member.role,
        name: displayName(member),
        open: open.length,
        completed: completed.length,
        overdue: overdue.length,
        urgent: urgent.length,
        loadScore,
        loadPercent: 0,
      };
    })
    .sort((a, b) => b.loadScore - a.loadScore);
  const maxLoad = Math.max(1, ...workload.map((member) => member.loadScore));
  const normalizedWorkload = workload.map((member) => ({
    ...member,
    loadPercent: Math.min(100, Math.round((member.loadScore / maxLoad) * 100)),
  }));

  const projectNameById = new Map(data.projects.map((project) => [project.id, project.name]));
  const sprintPulse = activeSprints.map((sprint) => {
    const sprintTasks = actionableTasks.filter((task) => task.sprint_id === sprint.id);
    const sprintDone = sprintTasks.filter((task) => task.status === "done");
    const totalPoints = sprintTasks.reduce((sum, task) => sum + Number(task.story_points ?? 0), 0);
    const donePoints = sprintDone.reduce((sum, task) => sum + Number(task.story_points ?? 0), 0);
    const daysLeft = sprint.end_date ? Math.max(0, daysBetween(today, new Date(sprint.end_date))) : 0;
    return {
      id: sprint.id,
      name: sprint.name,
      projectName: projectNameById.get(sprint.project_id) ?? "Project",
      total: sprintTasks.length,
      done: sprintDone.length,
      totalPoints,
      donePoints,
      daysLeft,
      progress: percentage(sprintDone.length, sprintTasks.length),
    };
  });

  const milestoneTimeline = data.milestones
    .slice()
    .sort((a, b) => (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31"))
    .slice(0, 6)
    .map((milestone) => {
      const milestoneTasks = actionableTasks.filter((task) => task.milestone_id === milestone.id);
      const milestoneDone = milestoneTasks.filter((task) => task.status === "done");
      const overdue = Boolean(milestone.due_date && new Date(milestone.due_date) < today && milestone.status !== "completed");
      return {
        id: milestone.id,
        name: milestone.name,
        status: milestone.status,
        projectName: projectNameById.get(milestone.project_id) ?? "Project",
        dueLabel: milestone.due_date ? `Due ${formatDate(milestone.due_date)}` : "No due date",
        overdue,
        progress: milestone.status === "completed" ? 100 : percentage(milestoneDone.length, milestoneTasks.length),
      };
    });

  const myTasks = openTasks
    .filter((task) => task.assignee_id === data.currentUserId)
    .sort(taskPrioritySort)
    .slice(0, 7);

  const dueTomorrow = openTasks.filter((task) => {
    if (!task.due_date) return false;
    const due = new Date(task.due_date);
    return due >= addDays(today, 1) && due < addDays(today, 2);
  });
  const dueTodayList = openTasks.filter((task) => {
    if (!task.due_date) return false;
    const due = new Date(task.due_date);
    return due >= today && due < addDays(today, 1);
  });

  // Overdue trend: for each of the last 14 days, count of tasks that were overdue as of that day.
  const overdueTrend = Array.from({ length: 14 }, (_, index) => {
    const day = addDays(today, index - 13);
    const count = actionableTasks.filter((task) => {
      if (!task.due_date) return false;
      const due = new Date(task.due_date);
      if (due >= day) return false;
      // Considered overdue on that day if still open then (created before that day and not completed before that day)
      if (new Date(task.created_at) > day) return false;
      if (task.status === "done" && task.completed_at && new Date(task.completed_at) <= day) return false;
      return true;
    }).length;
    return { label: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }), count };
  });
  const overdueTrendDelta = overdueTrend[13].count - overdueTrend[6].count;

  const atRiskProjects = projectHealth.filter((item) => item.health === "at_risk").length;

  const nameByUser = new Map(data.members.map((member) => [member.user_id, displayName(member)]));
  const missedDeadlines = overdueTasks
    .slice()
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
    .slice(0, 8)
    .map((task) => {
      const due = task.due_date ? new Date(task.due_date) : null;
      const daysLate = due ? Math.max(1, daysBetween(due, now)) : 0;
      return {
        id: task.id,
        title: task.title,
        projectName: projectNameById.get(task.project_id) ?? "Project",
        projectKey: data.projects.find((project) => project.id === task.project_id)?.key ?? "",
        owner: task.assignee_id ? nameByUser.get(task.assignee_id) ?? "Unassigned" : "Unassigned",
        priority: task.priority,
        status: task.status,
        dueAt: task.due_date,
        daysLate,
        updatedAt: task.updated_at,
      };
    });

  return {
    actionableTasks: actionableTasks.length,
    doneTasks: doneTasks.length,
    openTasks: openTasks.length,
    progress,
    activeProjects,
    atRiskProjects,
    activeSprints,
    completedThisWeek,
    createdThisWeek,
    velocity: Math.round((completedThisWeek / 7) * 10) / 10,
    overdueTasks: overdueTasks.length,
    overdueList: overdueTasks.sort(taskPrioritySort).slice(0, 5),
    overdueTrend,
    overdueTrendDelta,
    dueSoonTasks: dueSoonTasks.length,
    dueTodayCount: dueTodayList.length,
    dueTodayList: dueTodayList.sort(taskPrioritySort).slice(0, 5),
    dueTomorrowCount: dueTomorrow.length,
    unassignedTasks: unassignedTasks.length,
    unassignedList: unassignedTasks.sort(taskPrioritySort).slice(0, 5),
    urgentTasks: urgentTasks.length,
    atRiskTasks: overdueTasks.length + urgentTasks.length,
    reviewQueue,
    staleList,
    membersWithWork: normalizedWorkload.filter((member) => member.open > 0).length,
    projectHealth,
    statusData,
    priorityData,
    trendData,
    workload: normalizedWorkload.slice(0, 6),
    sprintPulse,
    milestoneTimeline,
    myTasks,
    missedDeadlines,
  };
}


function KpiWidget({
  title,
  value,
  hint,
  icon: Icon,
  tone,
  progress,
  trend,
}: {
  title: string;
  value: number | string;
  hint: string;
  icon: typeof TrendingUp;
  tone: "emerald" | "red" | "blue" | "amber" | "violet" | "slate";
  progress?: number;
  trend?: Array<{ label: string; count: number }>;
}) {
  const toneAccent = {
    emerald: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
    red: "text-red-300 bg-red-500/10 border-red-500/30",
    blue: "text-blue-300 bg-blue-500/10 border-blue-500/30",
    amber: "text-amber-300 bg-amber-500/10 border-amber-500/30",
    violet: "text-violet-300 bg-violet-500/10 border-violet-500/30",
    slate: "text-slate-300 bg-slate-500/10 border-slate-500/30",
  }[tone];
  const strokeColor = {
    emerald: "#34d399",
    red: "#f87171",
    blue: "#60a5fa",
    amber: "#f59e0b",
    violet: "#c084fc",
    slate: "#94a3b8",
  }[tone];
  const toneCard = {
    emerald: "border-emerald-500 bg-emerald-600 text-white",
    red: "border-red-500 bg-red-600 text-white",
    blue: "border-blue-500 bg-blue-600 text-white",
    amber: "border-amber-500 bg-amber-600 text-white",
    violet: "border-violet-500 bg-violet-600 text-white",
    slate: "border-slate-500 bg-slate-600 text-white",
  }[tone];

  return (
    <div className={cn("rounded-2xl border p-4 shadow-sm transition-transform hover:-translate-y-0.5", toneCard)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white">{title}</p>
          <div className="mt-2 text-3xl font-bold tracking-tight text-white">{value}</div>
        </div>
        <div className={cn("rounded-lg border p-1.5", toneAccent)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-2 text-xs font-medium text-white">{hint}</p>
      {typeof progress === "number" && <Progress value={progress} className="mt-3 h-1.5 bg-muted/60" />}
      {trend && trend.length > 0 && (
        <ChartContainer config={{ count: { label: "Overdue", color: strokeColor } }} className="mt-3 h-[48px] w-full">
          <AreaChart data={trend} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={`kpi-${tone}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.5} />
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="count" stroke={strokeColor} fill={`url(#kpi-${tone})`} strokeWidth={1.5} isAnimationActive={false} />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  );
}

type MissedDeadlineItem = {
  id: string;
  title: string;
  projectName: string;
  projectKey: string;
  owner: string;
  priority: Task["priority"];
  status: Task["status"];
  dueAt: string | null;
  daysLate: number;
  updatedAt: string;
};

function MissedDeadlinePanel({ items }: { items: MissedDeadlineItem[] }) {
  if (items.length === 0) {
    return <EmptyPanel icon={ShieldAlert} text="No missed deadlines. Nice work keeping delivery on track." />;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="font-mono">{item.projectKey}</span>
                <span>·</span>
                <span className="truncate">{item.projectName}</span>
              </div>
              <div className="mt-1 line-clamp-1 text-sm font-medium">{item.title}</div>
            </div>
            <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-300">
              {item.daysLate}d late
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {item.owner}
            </span>
            <span className={priorityColorMap[item.priority]}>{item.priority}</span>
            <span className={cn("rounded px-1.5 py-0.5", statusColorMap[item.status])}>
              {TASK_STATUSES.find((status) => status.value === item.status)?.label ?? item.status}
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              Due {item.dueAt ? new Date(item.dueAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3 w-3" />
              Updated {new Date(item.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}




function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  tone,
  progress,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: typeof TrendingUp;
  tone: "emerald" | "red" | "blue" | "amber" | "violet" | "slate";
  progress?: number;
}) {
  const tones = {
    emerald: { card: "border-emerald-500 bg-emerald-600", icon: "bg-white/15 text-white" },
    red: { card: "border-red-500 bg-red-600", icon: "bg-white/15 text-white" },
    blue: { card: "border-blue-500 bg-blue-600", icon: "bg-white/15 text-white" },
    amber: { card: "border-amber-500 bg-amber-600", icon: "bg-white/15 text-white" },
    violet: { card: "border-violet-500 bg-violet-600", icon: "bg-white/15 text-white" },
    slate: { card: "border-slate-500 bg-slate-600", icon: "bg-white/15 text-white" },
  }[tone];

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border p-4 shadow-sm transition-transform hover:-translate-y-0.5", tones.card)}>
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-current opacity-[0.035]" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-white">{title}</p>
          <div className="mt-2 text-3xl font-bold tracking-tight text-white">{value}</div>
        </div>
        <div className={cn("rounded-xl p-2 shadow-sm", tones.icon)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-2 text-xs font-medium text-white">{subtitle}</p>
      {typeof progress === "number" && <Progress value={progress} className="mt-3 h-1.5 bg-muted/60" />}
    </div>
  );
}

function MiniSignal({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof CheckCircle2; tone: "emerald" | "blue" | "amber" | "violet" }) {
  const colors = { emerald: "border-emerald-500 bg-emerald-600", blue: "border-blue-500 bg-blue-600", amber: "border-amber-500 bg-amber-600", violet: "border-violet-500 bg-violet-600" }[tone];
  return (
    <div className={cn("flex items-center justify-between rounded-xl border px-4 py-3 text-white shadow-sm transition-transform hover:-translate-y-0.5", colors)}>
      <div>
        <div className="text-lg font-bold text-white">{value}</div>
        <div className="text-xs font-semibold text-white">{label}</div>
      </div>
      <div className="rounded-lg bg-current/10 p-2"><Icon className="h-4 w-4" /></div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.07] via-card to-card p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ActionList({
  title,
  icon: Icon,
  tasks,
  tone,
}: {
  title: string;
  icon: typeof Flame;
  tasks: Task[];
  tone: "red" | "violet" | "amber" | "slate";
}) {
  const toneClass = {
    red: "border-red-500/20 from-red-500/12 text-red-500",
    violet: "border-violet-500/20 from-violet-500/12 text-violet-500",
    amber: "border-amber-500/20 from-amber-500/12 text-amber-500",
    slate: "border-slate-500/20 from-slate-500/12 text-slate-500",
  }[tone];

  return (
    <div className={cn("rounded-xl border bg-gradient-to-br via-background/70 to-background/40 p-3 shadow-sm", toneClass)}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4" />
          {title}
        </div>
        <Badge variant="outline">{tasks.length}</Badge>
      </div>
      <div className="space-y-2">
        {tasks.length === 0 ? (
          <p className="rounded-lg bg-muted/20 px-3 py-3 text-xs text-muted-foreground">Clear for now.</p>
        ) : (
          tasks.map((task) => <TaskRow key={task.id} task={task} compact />)
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, compact = false }: { task: Task; compact?: boolean }) {
  const overdue = isOverdue(task.due_date, startOfDay(new Date()));
  const status = TASK_STATUSES.find((item) => item.value === task.status)?.label ?? task.status;
  return (
    <div className="rounded-lg border border-primary/10 bg-gradient-to-r from-primary/[0.06] to-card px-3 py-2 text-sm transition-colors hover:border-primary/25 hover:bg-primary/[0.08]">
      <div className="line-clamp-1 font-medium">{task.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className={cn("rounded px-1.5 py-0.5", statusColorMap[task.status])}>{status}</span>
        <span className={priorityColorMap[task.priority]}>{task.priority}</span>
        {!compact && <span>·</span>}
        <span className={overdue ? "text-red-400" : undefined}>{task.due_date ? `Due ${formatDate(task.due_date)}` : "No due date"}</span>
      </div>
    </div>
  );
}

function HealthBadge({ health }: { health: ProjectHealth["health"] }) {
  const label = {
    on_track: "On track",
    watch: "Watch",
    at_risk: "At risk",
    paused: "Paused",
    complete: "Complete",
  }[health];
  const className = {
    on_track: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    watch: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    at_risk: "border-red-500/30 bg-red-500/10 text-red-300",
    paused: "border-slate-500/30 bg-slate-500/10 text-slate-300",
    complete: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  }[health];
  return <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", className)}>{label}</span>;
}

function EmptyPanel({ icon: Icon, text }: { icon: typeof Users; text: string }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-primary/20 bg-gradient-to-br from-primary/[0.07] to-background/30 px-4 py-10 text-center">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <p className="mt-2 text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

function EmptyWorkspace({ canCreate }: { canCreate: boolean }) {
  return (
    <div className="mt-8 grid place-items-center rounded-2xl border border-dashed border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card px-6 py-16 text-center shadow-sm">
      <FolderKanban className="h-9 w-9 text-muted-foreground" />
      <h2 className="mt-4 text-lg font-medium">No projects yet</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Create the first project to unlock portfolio progress, Kanban tracking, sprint analytics, milestone health, and accountability insights.
      </p>
      {canCreate && (
        <div className="mt-5">
          <NewProjectDialog />
        </div>
      )}
    </div>
  );
}

function DashboardLoading() {
  return (
    <div className="mt-8 space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-2xl border border-border/60 bg-card/35" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="h-80 animate-pulse rounded-2xl border border-border/60 bg-card/35" />
        <div className="h-80 animate-pulse rounded-2xl border border-border/60 bg-card/35" />
      </div>
    </div>
  );
}

function WidgetEditor({ widgets }: { widgets: ReturnType<typeof useWidgetPrefs> }) {
  const groups = Array.from(new Set(ALL_WIDGETS.map((w) => w.group)));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="h-4 w-4" /> Edit dashboard
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Widgets</span>
          <button
            onClick={widgets.reset}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Show all
          </button>
        </div>
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group}>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{group}</div>
              <div className="space-y-1.5">
                {ALL_WIDGETS.filter((w) => w.group === group).map((w) => (
                  <label
                    key={w.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
                  >
                    <Checkbox
                      checked={widgets.show(w.id)}
                      onCheckedChange={() => widgets.toggle(w.id)}
                    />
                    <span className="text-sm">{w.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function riskScore(item: ProjectHealth) {
  const healthWeight = { at_risk: 100, watch: 60, paused: 45, on_track: 20, complete: 0 }[item.health];
  return healthWeight + item.overdue * 12 + item.urgent * 8 + item.open - item.progress / 10;
}

function displayName(member: MemberRow) {
  return member.profile?.full_name || member.profile?.email?.split("@")[0] || "Unknown teammate";
}

function taskPrioritySort(a: Task, b: Task) {
  const priorityRank: Record<Task["priority"], number> = { urgent: 4, high: 3, medium: 2, low: 1 };
  const dueA = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
  const dueB = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
  return priorityRank[b.priority] - priorityRank[a.priority] || dueA - dueB;
}

function percentage(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function daysBetween(start: Date, end: Date) {
  return Math.ceil((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000);
}

function isWithin(date: Date, start: Date, end: Date) {
  return date >= start && date < end;
}

function isOverdue(value: string | null, today: Date) {
  return Boolean(value && new Date(value) < today);
}

function isDueSoon(value: string | null, today: Date) {
  if (!value) return false;
  const due = new Date(value);
  return due >= today && due <= addDays(today, 7);
}
