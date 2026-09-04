import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { postgres } from "@/integrations/postgres/client";
import { useAuthSession, setCurrentOrgId, signOutAndRedirect } from "@/lib/auth";
import { useOrg } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ShiftSettingsPanel } from "@/components/shifts/shift-settings-panel";
import { TaskApprovalPanel } from "@/components/app/task-approval-panel";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Plus, LogOut } from "lucide-react";


export const Route = createFileRoute("/_authenticated/app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuthSession();
  const { currentOrg, role, refresh } = useOrg();
  const canManage = role === "owner" || role === "admin";

  const [fullName, setFullName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [wsName, setWsName] = useState(currentOrg.organization.name);
  const [wsSlug, setWsSlug] = useState(currentOrg.organization.slug);
  const [savingWs, setSavingWs] = useState(false);
  const [creationApproval, setCreationApproval] = useState(false);
  const [completionApproval, setCompletionApproval] = useState(false);
  const [savingTaskSettings, setSavingTaskSettings] = useState(false);

  useEffect(() => {
    if (!user) return;
    postgres
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => setFullName(data?.full_name ?? user.user_metadata?.full_name ?? ""));
  }, [user]);

  useEffect(() => {
    setWsName(currentOrg.organization.name);
    setWsSlug(currentOrg.organization.slug);
  }, [currentOrg]);

  useEffect(() => {
    postgres.from("organizations").select("require_task_creation_approval,require_task_completion_approval").eq("id", currentOrg.organization_id).single().then(({ data }) => {
      setCreationApproval(Boolean(data?.require_task_creation_approval));
      setCompletionApproval(Boolean(data?.require_task_completion_approval));
    });
  }, [currentOrg.organization_id]);

  async function saveTaskSettings() {
    setSavingTaskSettings(true);
    const { error } = await postgres.from("organizations").update({ require_task_creation_approval: creationApproval, require_task_completion_approval: completionApproval }).eq("id", currentOrg.organization_id);
    setSavingTaskSettings(false);
    if (error) return toast.error(error.message);
    toast.success("Task approval settings saved");
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSavingProfile(true);
    const { error } = await postgres.from("profiles").update({ full_name: fullName }).eq("id", user.id);
    setSavingProfile(false);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
  }

  async function saveWorkspace(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(60),
        slug: z.string().trim().min(2).max(40).regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and dashes only"),
      })
      .safeParse({ name: wsName, slug: wsSlug });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    setSavingWs(true);
    const { error } = await postgres
      .from("organizations")
      .update({ name: parsed.data.name, slug: parsed.data.slug })
      .eq("id", currentOrg.organization_id);
    setSavingWs(false);
    if (error) return toast.error(error.message);
    await refresh();
    toast.success("Workspace updated");
  }

  async function signOut() {
    await signOutAndRedirect();
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your profile, workspace, and shift configuration.</p>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="shifts">Shifts</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>
        <TabsContent value="shifts" className="mt-4">
          <ShiftSettingsPanel orgId={currentOrg.organization_id} canManage={role === "owner" || role === "admin" || role === "manager"} />
        </TabsContent>
        <TabsContent value="tasks" className="mt-4 space-y-6">
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-sm font-semibold">Task approvals</h2>
            <p className="mt-1 text-xs text-muted-foreground">Control whether member actions need a manager’s approval.</p>
            <div className="mt-5 space-y-4">
              <label className="flex items-center justify-between gap-4"><span><span className="block text-sm font-medium">Approve new member tasks</span><span className="block text-xs text-muted-foreground">Member-created tasks stay private until approved.</span></span><Switch checked={creationApproval} onCheckedChange={setCreationApproval} disabled={!canManage} /></label>
              <label className="flex items-center justify-between gap-4"><span><span className="block text-sm font-medium">Approve task completion</span><span className="block text-xs text-muted-foreground">Members submit completion instead of immediately closing tasks.</span></span><Switch checked={completionApproval} onCheckedChange={setCompletionApproval} disabled={!canManage} /></label>
            </div>
            {canManage && <Button size="sm" className="mt-5" disabled={savingTaskSettings} onClick={saveTaskSettings}>{savingTaskSettings && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save task settings</Button>}
          </section>
          {(role === "owner" || role === "admin" || role === "manager") && <TaskApprovalPanel orgId={currentOrg.organization_id} />}
        </TabsContent>
        <TabsContent value="general" className="mt-4 space-y-6">


      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold">Your profile</h2>
        <p className="text-xs text-muted-foreground">This name is shown to teammates.</p>
        <form onSubmit={saveProfile} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Full name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Email</Label>
            <Input value={user?.email ?? ""} disabled />
          </div>
          <Button type="submit" size="sm" disabled={savingProfile}>
            {savingProfile && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save profile
          </Button>
        </form>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold">Workspace</h2>
        <p className="text-xs text-muted-foreground">
          {canManage ? "Owners and admins can rename the workspace." : "Only owners and admins can edit these."}
        </p>
        <form onSubmit={saveWorkspace} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input value={wsName} onChange={(e) => setWsName(e.target.value)} disabled={!canManage} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">URL slug</Label>
            <div className="flex items-center rounded-md border border-input bg-input/40 px-3 text-sm text-muted-foreground">
              <span className="select-none">helix.app/</span>
              <input
                value={wsSlug}
                onChange={(e) => setWsSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                disabled={!canManage}
                className="flex-1 bg-transparent py-2 text-foreground outline-none disabled:cursor-not-allowed"
              />
            </div>
          </div>
          {canManage && (
            <Button type="submit" size="sm" disabled={savingWs}>
              {savingWs && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save workspace
            </Button>
          )}
        </form>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Create another workspace</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Start a fresh workspace for a different team or client. You'll be the owner.
            </p>
          </div>
          <Button asChild size="sm">
            <Link
              to="/onboarding"
              search={{ mode: "additional" }}
              onClick={() => setCurrentOrgId(currentOrg.organization_id)}
            >
              <Plus className="h-4 w-4" />
              New workspace
            </Link>
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold">Sign out</h2>
        <p className="mt-1 text-xs text-muted-foreground">End your session on this device.</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={signOut}>
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
