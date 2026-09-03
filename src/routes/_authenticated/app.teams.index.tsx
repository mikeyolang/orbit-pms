import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { postgres } from "@/integrations/postgres/client";
import { useOrg } from "@/components/app/app-shell";
import { useAuthSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Palette, Smartphone, Code2, Bug, Cloud, Rocket, Megaphone, PenTool,
  Users2, Loader2, Plus, Trash2, Sparkles, UserPlus,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/teams/")({
  component: TeamsPage,
});

const ICONS = {
  Palette, Smartphone, Code2, Bug, Cloud, Rocket, Megaphone, PenTool, Users2,
} as const;
type IconName = keyof typeof ICONS;

const COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6"];

const PRESETS: { name: string; slug: string; icon: IconName; color: string; description: string }[] = [
  { name: "Design (UX)", slug: "design", icon: "Palette", color: "#ec4899", description: "Product design, research, and visual craft." },
  { name: "Mobile", slug: "mobile", icon: "Smartphone", color: "#10b981", description: "iOS and Android engineering." },
  { name: "Web", slug: "web", icon: "Code2", color: "#3b82f6", description: "Frontend and full-stack web engineering." },
  { name: "Backend", slug: "backend", icon: "Cloud", color: "#8b5cf6", description: "APIs, services, data pipelines." },
  { name: "QA", slug: "qa", icon: "Bug", color: "#ef4444", description: "Testing, automation, release quality." },
  { name: "DevOps", slug: "devops", icon: "Rocket", color: "#f59e0b", description: "Infra, CI/CD, and reliability." },
  { name: "Product", slug: "product", icon: "Sparkles" as IconName, color: "#6366f1", description: "Roadmap, discovery, product ops." },
  { name: "Marketing", slug: "marketing", icon: "Megaphone", color: "#14b8a6", description: "Growth, content, and campaigns." },
];

type Team = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  color: string;
  icon: string;
  description: string | null;
};

type Member = { user_id: string; full_name: string | null; email: string | null; role?: string };
type TeamMember = { team_id: string; user_id: string; role: string };

function TeamsPage() {
  const { currentOrg, role } = useOrg();
  const { user } = useAuthSession();
  const orgId = currentOrg.organization_id;
  const canManage = role === "owner" || role === "admin" || role === "manager";

  const [teams, setTeams] = useState<Team[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [taskCounts, setTaskCounts] = useState<Record<string, { total: number; open: number }>>({});

  const load = useCallback(async () => {
    const { data: teamsData } = await postgres
      .from("teams")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true });
    const list = (teamsData ?? []) as Team[];
    setTeams(list);

    const { data: memRows } = await postgres
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", orgId);
    const rows = memRows ?? [];
    const ids = rows.map((m) => m.user_id);
    const { data: profiles } = ids.length
      ? await postgres.from("profiles").select("id, full_name, email").in("id", ids)
      : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    setMembers(
      rows.map((r) => {
        const p = byId.get(r.user_id);
        return {
          user_id: r.user_id,
          full_name: p?.full_name ?? null,
          email: p?.email ?? null,
          role: r.role as string,
        };
      }),
    );

    if (list.length > 0) {
      const teamIds = list.map((t) => t.id);
      const [{ data: tm }, { data: tasks }] = await Promise.all([
        postgres.from("team_members").select("team_id, user_id, role").in("team_id", teamIds),
        postgres.from("tasks").select("team_id, status").in("team_id", teamIds),
      ]);
      setTeamMembers((tm ?? []) as TeamMember[]);
      const counts: Record<string, { total: number; open: number }> = {};
      for (const t of tasks ?? []) {
        const key = (t as { team_id: string }).team_id;
        const c = counts[key] ?? { total: 0, open: 0 };
        c.total += 1;
        if ((t as { status: string }).status !== "done" && (t as { status: string }).status !== "cancelled") c.open += 1;
        counts[key] = c;
      }
      setTaskCounts(counts);
    } else {
      setTeamMembers([]);
      setTaskCounts({});
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  // Realtime
  useEffect(() => {
    const ch = postgres
      .channel(`teams:${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, () => load())
      .subscribe();
    return () => { postgres.removeChannel(ch); };
  }, [orgId, load]);

  const membersByTeam = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const tm of teamMembers) {
      const arr = m.get(tm.team_id) ?? [];
      arr.push(tm.user_id);
      m.set(tm.team_id, arr);
    }
    return m;
  }, [teamMembers]);

  async function createPreset(preset: typeof PRESETS[number]) {
    if (!user) return;
    const { error } = await postgres.from("teams").insert({
      organization_id: orgId,
      name: preset.name,
      slug: preset.slug,
      color: preset.color,
      icon: preset.icon,
      description: preset.description,
      created_by: user.id,
    });
    if (error) return toast.error(error.message);
    toast.success(`${preset.name} team created`);
    load();
  }

  async function deleteTeam(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This will not delete tasks.`)) return;
    const { error } = await postgres.from("teams").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Team deleted");
    load();
  }

  if (teams === null) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const existingSlugs = new Set(teams.map((t) => t.slug));
  const availablePresets = PRESETS.filter((p) => !existingSlugs.has(p.slug));

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users2 className="h-3.5 w-3.5" />
            Squads & pods
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Teams</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organize people into squads — Design, Mobile, Backend, and more — and tag tasks to route work faster.
          </p>
        </div>
        {canManage && <NewTeamDialog orgId={orgId} onCreated={load} />}
      </div>

      <Tabs defaultValue="teams" className="mt-6">
        <TabsList>
          <TabsTrigger value="teams">Teams ({teams.length})</TabsTrigger>
          <TabsTrigger value="members">Members ({members.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-6">
          <div className="overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Member</th>
                  <th className="px-4 py-2 text-left font-medium">Email</th>
                  <th className="px-4 py-2 text-left font-medium">Role</th>
                  <th className="px-4 py-2 text-left font-medium">Teams</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const memberTeams = teams.filter((t) => (membersByTeam.get(t.id) ?? []).includes(m.user_id));
                  return (
                    <tr key={m.user_id} className="border-t border-border">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="grid h-7 w-7 place-items-center rounded-full text-[10px] font-semibold text-white"
                            style={{ backgroundColor: colorForId(m.user_id) }}
                          >
                            {(m.full_name ?? m.email ?? "?").slice(0, 1).toUpperCase()}
                          </span>
                          <span className="font-medium">{m.full_name ?? "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{m.email ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className="capitalize text-[10px]">{m.role ?? "member"}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        {memberTeams.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No team</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {memberTeams.map((t) => (
                              <span
                                key={t.id}
                                className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                                style={{ backgroundColor: t.color }}
                              >
                                {t.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {members.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No members yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="teams" className="mt-6">
      {teams.length === 0 && canManage && availablePresets.length > 0 && (
        <section className="mt-8 rounded-2xl border border-dashed border-border bg-card/40 p-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-medium">Quick start — spin up common teams</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Click any preset to create it instantly. You can customize color, icon, and members afterwards.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {PRESETS.map((p) => {
              const Icon = ICONS[p.icon] ?? Users2;
              return (
                <button
                  key={p.slug}
                  onClick={() => createPreset(p)}
                  className="group flex items-start gap-3 rounded-xl border border-border bg-background p-3 text-left transition hover:border-primary/40 hover:bg-accent"
                >
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white"
                    style={{ backgroundColor: p.color }}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {teams.length === 0 && !canManage && (
        <div className="mt-8 grid place-items-center rounded-2xl border border-dashed border-border bg-card/30 px-6 py-16 text-center">
          <Users2 className="h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 text-sm font-medium">No teams yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">Ask a manager to create the first team.</p>
        </div>
      )}

      {teams.length > 0 && (
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => {
            const Icon = ICONS[team.icon as IconName] ?? Users2;
            const memberIds = membersByTeam.get(team.id) ?? [];
            const memberProfiles = memberIds
              .map((id) => members.find((m) => m.user_id === id))
              .filter(Boolean) as Member[];
            const counts = taskCounts[team.id] ?? { total: 0, open: 0 };
            return (
              <div
                key={team.id}
                className="rounded-2xl border border-border bg-card p-5 shadow-sm"
                style={{ borderTopColor: team.color, borderTopWidth: 3 }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="grid h-10 w-10 place-items-center rounded-lg text-white"
                      style={{ backgroundColor: team.color }}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="text-sm font-semibold">{team.name}</div>
                      <div className="text-xs text-muted-foreground">{memberProfiles.length} members</div>
                    </div>
                  </div>
                  {canManage && (
                    <button
                      onClick={() => deleteTeam(team.id, team.name)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete team"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {team.description && (
                  <p className="mt-3 text-xs text-muted-foreground">{team.description}</p>
                )}

                <div className="mt-4 flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {memberProfiles.slice(0, 5).map((m) => (
                      <div
                        key={m.user_id}
                        className="grid h-7 w-7 place-items-center rounded-full text-[10px] font-semibold text-white ring-2 ring-card"
                        style={{ backgroundColor: colorForId(m.user_id) }}
                        title={m.full_name ?? m.email ?? ""}
                      >
                        {(m.full_name ?? m.email ?? "?").slice(0, 1).toUpperCase()}
                      </div>
                    ))}
                    {memberProfiles.length === 0 && (
                      <span className="text-xs text-muted-foreground">No members yet</span>
                    )}
                    {memberProfiles.length > 5 && (
                      <div className="grid h-7 w-7 place-items-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-card">
                        +{memberProfiles.length - 5}
                      </div>
                    )}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {counts.open} open
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {counts.total} total
                    </Badge>
                  </div>
                </div>

                {canManage && (
                  <div className="mt-4 border-t border-border pt-3">
                    <ManageMembers
                      team={team}
                      members={members}
                      memberIds={memberIds}
                      onChanged={load}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function colorForId(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

function ManageMembers({
  team, members, memberIds, onChanged,
}: {
  team: Team;
  members: Member[];
  memberIds: string[];
  onChanged: () => void;
}) {
  const [pick, setPick] = useState("none");
  const available = members.filter((m) => !memberIds.includes(m.user_id));

  async function add() {
    if (pick === "none") return;
    const { error } = await postgres.from("team_members").insert({ team_id: team.id, user_id: pick, role: "member" });
    if (error) return toast.error(error.message);
    setPick("none");
    onChanged();
  }

  async function remove(userId: string) {
    const { error } = await postgres.from("team_members").delete().eq("team_id", team.id).eq("user_id", userId);
    if (error) return toast.error(error.message);
    onChanged();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select value={pick} onValueChange={setPick}>
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue placeholder={available.length ? "Add member…" : "Everyone already added"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Select a person…</SelectItem>
            {available.map((m) => (
              <SelectItem key={m.user_id} value={m.user_id}>
                {m.full_name ?? m.email ?? "Unknown"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={add} disabled={pick === "none"}>
          <UserPlus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
      {memberIds.length > 0 && (
        <ul className="space-y-1">
          {memberIds.map((id) => {
            const m = members.find((x) => x.user_id === id);
            return (
              <li key={id} className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1 text-xs">
                <span className="truncate">{m?.full_name ?? m?.email ?? "Unknown"}</span>
                <button
                  onClick={() => remove(id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remove"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NewTeamDialog({ orgId, onCreated }: { orgId: string; onCreated: () => void }) {
  const { user } = useAuthSession();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [icon, setIcon] = useState<IconName>("Users2");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(50),
        slug: z.string().trim().min(2).max(40).regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and dashes only"),
      })
      .safeParse({ name, slug: slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);

    setLoading(true);
    const { error } = await postgres.from("teams").insert({
      organization_id: orgId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      color,
      icon,
      description: description.trim() || null,
      created_by: user.id,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Team created");
    setOpen(false);
    setName(""); setSlug(""); setDescription(""); setColor(COLORS[0]); setIcon("Users2");
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4" />New team</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create team</DialogTitle></DialogHeader>
        <form onSubmit={create} className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Design" required />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Slug (optional)</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="auto" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Color</Label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-md ring-offset-background transition ${color === c ? "ring-2 ring-primary ring-offset-2" : ""}`}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Icon</Label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ICONS) as IconName[]).map((k) => {
                const Icon = ICONS[k];
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setIcon(k)}
                    className={`grid h-8 w-8 place-items-center rounded-md border transition ${icon === k ? "border-primary bg-accent" : "border-border hover:bg-accent"}`}
                    aria-label={k}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create team
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
