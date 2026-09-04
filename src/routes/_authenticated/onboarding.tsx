import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { postgres } from "@/integrations/postgres/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { toast } from "sonner";
import {
  ArrowRight,
  Building2,
  Clock3,
  Loader2,
  LogOut,
  Mail,
  Plus,
  UserCog,
} from "lucide-react";
import { membershipRoleLabel, setCurrentOrgId, signOutAndRedirect, type OrgMembership } from "@/lib/auth";
import { getMyMemberships } from "@/lib/api/session.functions";

export const Route = createFileRoute("/_authenticated/onboarding")({
  validateSearch: z.object({
    mode: z.enum(["additional"]).optional(),
  }),
  component: WorkspaceHome,
});

interface PendingInvite {
  id: string;
  organization_id: string;
  organization_name: string;
  role: string;
  token: string;
  expires_at: string;
}

interface MyJoinRequest {
  id: string;
  organization_id: string;
  organization_name: string;
  status: "pending" | "approved" | "declined";
  created_at: string;
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function WorkspaceHome() {
  const { mode } = Route.useSearch();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<OrgMembership[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [requests, setRequests] = useState<MyJoinRequest[]>([]);
  const [profile, setProfile] = useState<{ id: string; full_name: string | null; email: string | null } | null>(null);

  const [createOpen, setCreateOpen] = useState(mode === "additional");
  const [profileOpen, setProfileOpen] = useState(false);

  const load = useCallback(async () => {
    const { data: u } = await postgres.auth.getUser();
    const [m, inv, jr, prof] = await Promise.all([
      getMyMemberships().then((data) => ({ data })),
      postgres.rpc("my_pending_invites"),
      postgres.rpc("my_join_requests"),
      u.user ? postgres.from("profiles").select("id, full_name, email").eq("id", u.user.id).maybeSingle() : null,
    ]);
    const rawMemberships = (m.data ?? []) as unknown as OrgMembership[];
    const rank: Record<string, number> = { owner: 5, admin: 4, manager: 3, member: 2, viewer: 1 };
    const byOrg = new Map<string, OrgMembership>();
    for (const row of rawMemberships) {
      const existing = byOrg.get(row.organization_id);
      if (!existing || (rank[row.role] ?? 0) > (rank[existing.role] ?? 0)) byOrg.set(row.organization_id, row);
    }
    const nextMemberships = Array.from(byOrg.values());
    setMemberships(nextMemberships);
    setInvites((inv.data ?? []) as unknown as PendingInvite[]);
    setRequests((jr.data ?? []) as unknown as MyJoinRequest[]);
    if (prof?.data) setProfile(prof.data);
    else if (u.user) setProfile({ id: u.user.id, full_name: null, email: u.user.email ?? null });
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (mode === "additional") setCreateOpen(true);
  }, [mode]);

  function openWorkspace(m: OrgMembership) {
    setCurrentOrgId(m.organization_id);
    navigate({ to: "/app", replace: true });
  }

  async function signOut() {
    await signOutAndRedirect();
  }

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const displayName = profile?.full_name || profile?.email || "there";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-primary to-primary/60" />
            Helix
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-md border border-border/60 py-1 pl-1 pr-2.5 text-left hover:bg-accent">
                  <div className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {(profile?.full_name || profile?.email || "?")[0]?.toUpperCase()}
                  </div>
                  <span className="hidden max-w-[140px] truncate text-sm sm:block">{displayName}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                  {profile?.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setProfileOpen(true)}>
                  <UserCog className="h-4 w-4" /> Edit profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Hi, {displayName.split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your personal home. Pick a workspace or join a new one.</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <StatCard icon={Building2} label="Workspaces" value={memberships.length} tone="primary" />
          <StatCard icon={Mail} label="Invitations" value={invites.length} tone="success" />
          <StatCard icon={Clock3} label="Pending requests" value={pendingRequests.length} tone="warning" />
        </div>

        {invites.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-medium">Invitations for you</h2>
            <p className="text-xs text-muted-foreground">You were invited by email — one click and you're in.</p>
            <div className="mt-3 space-y-2">
              {invites.map((inv) => (
                <InviteRow key={inv.id} invite={inv} onDone={load} />
              ))}
            </div>
          </section>
        )}

        {pendingRequests.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-medium">Awaiting approval</h2>
            <div className="mt-3 space-y-2">
              {pendingRequests.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3"
                >
                  <Clock3 className="h-4 w-4 text-warning" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.organization_name}</div>
                    <div className="text-xs text-muted-foreground">
                      Join request sent — an admin needs to approve it.
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Workspaces dashboard</h2>
            {memberships.length > 0 && (
              <div className="flex gap-2">
                <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> New workspace
                </Button>
              </div>
            )}
          </div>

          {memberships.length > 0 ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {memberships.map((m) => (
                <button
                  key={m.organization_id}
                  type="button"
                  onClick={() => openWorkspace(m)}
                  className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card/50 p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent"
                >
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-sm font-semibold text-primary-foreground">
                    {m.organization.name[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.organization.name}</div>
                    <div className="truncate text-xs text-muted-foreground">Your role: {membershipRoleLabel(m)}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-border p-10 text-center">
              <Building2 className="mx-auto h-6 w-6 text-muted-foreground" />
              <h3 className="mt-3 text-sm font-medium">No workspaces yet</h3>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Create your own workspace, or ask a workspace administrator to invite you by email.
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" /> Create my workspace
                </Button>
              </div>
            </div>
          )}
        </section>
      </main>

      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          setCurrentOrgId(id);
          navigate({ to: "/app", replace: true });
        }}
      />
      {profile && (
        <EditProfileDialog open={profileOpen} onOpenChange={setProfileOpen} profile={profile} onSaved={load} />
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Building2;
  label: string;
  value: number;
  tone: "primary" | "success" | "warning";
}) {
  const tones = {
    primary: "border-primary/30 bg-primary/5 text-primary",
    success: "border-success/30 bg-success/5 text-success",
    warning: "border-warning/30 bg-warning/5 text-warning",
  } as const;
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-xs font-medium">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function InviteRow({ invite, onDone }: { invite: PendingInvite; onDone: () => Promise<void> }) {
  const navigate = useNavigate();
  const [working, setWorking] = useState(false);

  async function accept() {
    setWorking(true);
    navigate({ to: "/accept-invite/$token", params: { token: invite.token } });
    setWorking(false);
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <Mail className="h-4 w-4 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{invite.organization_name}</div>
        <div className="truncate text-xs capitalize text-muted-foreground">Invited as {invite.role}</div>
      </div>
      <Button size="sm" disabled={working} onClick={accept}>
        {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Join
      </Button>
    </div>
  );
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const slug = slugify(name);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(60),
        slug: z.string().trim().min(2).max(40).regex(/^[a-z0-9-]+$/, "Enter a valid workspace name"),
      })
      .safeParse({ name, slug });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);

    setLoading(true);
    const { data: user } = await postgres.auth.getUser();
    if (!user.user) {
      setLoading(false);
      return toast.error("You are signed out. Please sign in again.");
    }
    const { data, error } = await postgres
      .from("organizations")
      .insert({ name: parsed.data.name, slug: parsed.data.slug, created_by: user.user.id })
      .select("id")
      .maybeSingle();
    setLoading(false);
    if (error) {
      return toast.error(
        error.code === "23505" ? "That workspace URL is already taken. Try another name." : error.message,
      );
    }
    if (!data?.id) return toast.error("Workspace created but not visible yet. Reload and try again.");
    toast.success("Workspace created");
    onCreated(data.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a workspace</DialogTitle>
          <DialogDescription>You'll be the owner with full access.</DialogDescription>
        </DialogHeader>
        <form onSubmit={create} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Workspace name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc." required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">URL (auto-generated)</Label>
            <div className="flex items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
              <span className="select-none">helix.app/</span>
              <input
                value={slug}
                readOnly
                tabIndex={-1}
                className="flex-1 cursor-not-allowed bg-transparent py-2 text-foreground/80 outline-none"
                placeholder="acme"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditProfileDialog({
  open,
  onOpenChange,
  profile,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profile: { id: string; full_name: string | null; email: string | null };
  onSaved: () => Promise<void>;
}) {
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFullName(profile.full_name ?? "");
  }, [profile.full_name, open]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.string().trim().min(1, "Name is required").max(80).safeParse(fullName);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    setSaving(true);
    const { error } = await postgres.from("profiles").update({ full_name: parsed.data }).eq("id", profile.id);
    if (!error) await postgres.auth.updateUser({ data: { full_name: parsed.data } });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
    onOpenChange(false);
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>This name is shown to everyone in your workspaces.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Full name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Email</Label>
            <Input value={profile.email ?? ""} readOnly disabled />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving} className="w-full">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
