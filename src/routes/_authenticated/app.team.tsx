import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, Loader2, Mail, Trash2 } from "lucide-react";
import type { OrgRole } from "@/lib/auth";
import { JoinRequestsPanel } from "@/components/app/join-requests-panel";
import { PermissionsPanel } from "@/components/app/permissions-panel";

export const Route = createFileRoute("/_authenticated/app/team")({
  component: TeamPage,
});

const ROLES: OrgRole[] = ["owner", "admin", "manager", "member", "viewer"];

interface Member {
  id: string;
  user_id: string;
  role: OrgRole;
  is_support_only: boolean;
  profile: { full_name: string | null; email: string | null } | null;
}

interface Invitation {
  id: string;
  email: string;
  role: OrgRole;
  token: string;
  code: string;
  expires_at: string;
  accepted_at: string | null;
}

function TeamPage() {
  const { currentOrg, role: myRole } = useOrg();
  const orgId = currentOrg.organization_id;
  const canManage = myRole === "owner" || myRole === "admin";

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("member");
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [m, i] = await Promise.all([
      supabase
        .from("organization_members")
        .select("id, user_id, role, is_support_only, profile:profiles(full_name, email)")
        .eq("organization_id", orgId),
      supabase
        .from("invitations")
        .select("id, email, role, token, code, expires_at, accepted_at")
        .eq("organization_id", orgId)
        .is("accepted_at", null)
        .order("created_at", { ascending: false }),
    ]);
    if (m.data) setMembers(m.data as unknown as Member[]);
    if (i.data) setInvites(i.data as unknown as Invitation[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeRole(memberId: string, newRole: OrgRole) {
    const { error } = await supabase.from("organization_members").update({ role: newRole }).eq("id", memberId);
    if (error) return toast.error(error.message);
    toast.success("Role updated");
    load();
  }

  async function toggleSupport(memberId: string, value: boolean) {
    const { error } = await supabase.from("organization_members").update({ is_support_only: value }).eq("id", memberId);
    if (error) return toast.error(error.message);
    toast.success(value ? "Set to support-only" : "Full access restored");
    load();
  }

  async function removeMember(memberId: string) {

    if (!confirm("Remove this member from the workspace?")) return;
    const { error } = await supabase.from("organization_members").delete().eq("id", memberId);
    if (error) return toast.error(error.message);
    toast.success("Member removed");
    load();
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.string().email().safeParse(inviteEmail.trim());
    if (!parsed.success) return toast.error("Enter a valid email");
    setInviting(true);
    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase.from("invitations").insert({
      organization_id: orgId,
      email: parsed.data,
      role: inviteRole,
      invited_by: user.user!.id,
    });
    setInviting(false);
    if (error) return toast.error(error.message);
    setInviteEmail("");
    toast.success("Invitation created — share the link below");
    load();
  }

  async function revokeInvite(id: string) {
    const { error } = await supabase.from("invitations").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Invitation revoked");
    load();
  }

  function copyInviteLink(token: string) {
    const url = `${window.location.origin}/accept-invite/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Invite link copied");
  }

  function copyText(value: string, label: string) {
    navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">People & Roles</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage who can access {currentOrg.organization.name}.</p>
      </div>

      {canManage && currentOrg.organization.invite_code && (
        <section className="mt-8 rounded-xl border border-border/60 bg-card/40 p-5">
          <h2 className="text-sm font-medium">Workspace join code</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Anyone with this 8-character code can join {currentOrg.organization.name} as a member.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-lg tracking-[0.3em]">
              {currentOrg.organization.invite_code}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => copyText(currentOrg.organization.invite_code!, "Join code")}
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
          </div>
        </section>
      )}

      {canManage && (
        <section className="mt-8 rounded-xl border border-border/60 bg-card/40 p-5">
          <h2 className="text-sm font-medium">Invite a teammate</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Send a secure invite link. They'll create an account (or sign in) and join with the role you choose.
          </p>
          <form onSubmit={sendInvite} className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input type="email" placeholder="teammate@company.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as OrgRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.filter((r) => r !== "owner").map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={inviting} className="w-full sm:w-auto gap-2">
                {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Send invite
              </Button>
            </div>
          </form>
        </section>
      )}

      {canManage && <JoinRequestsPanel orgId={orgId} onChanged={load} />}

      <section className="mt-8">
        <h2 className="text-sm font-medium">Members ({members.length})</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-border/60">
          {loading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Name</th>
                  <th className="px-4 py-2 text-left font-medium">Email</th>
                  <th className="px-4 py-2 text-left font-medium">Role</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-t border-border/60">
                    <td className="px-4 py-2.5">{m.profile?.full_name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{m.profile?.email ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {canManage && m.role !== "owner" ? (
                        <Select value={m.role} onValueChange={(v) => changeRole(m.id, v as OrgRole)}>
                          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ROLES.filter((r) => r !== "owner").map((r) => (
                              <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs capitalize">{m.role}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {canManage && m.role !== "owner" && (
                        <div className="flex items-center justify-end gap-2">
                          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <input type="checkbox" checked={m.is_support_only}
                              onChange={(e) => toggleSupport(m.id, e.target.checked)} />
                            Support only
                          </label>
                          <Button variant="ghost" size="icon" onClick={() => removeMember(m.id)}>
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      )}
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {canManage && invites.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium">Pending invitations ({invites.length})</h2>
          <div className="mt-3 overflow-hidden rounded-xl border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Email</th>
                  <th className="px-4 py-2 text-left font-medium">Role</th>
                  <th className="px-4 py-2 text-left font-medium">Code</th>
                  <th className="px-4 py-2 text-left font-medium">Expires</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id} className="border-t border-border/60">
                    <td className="px-4 py-2.5">{i.email}</td>
                    <td className="px-4 py-2.5 capitalize">{i.role}</td>
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => copyText(i.code, "Invite code")}
                        className="rounded border border-border bg-muted/40 px-2 py-1 font-mono text-xs tracking-widest hover:bg-muted"
                      >
                        {i.code}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{new Date(i.expires_at).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 text-right space-x-1">
                      <Button variant="ghost" size="sm" onClick={() => copyInviteLink(i.token)} className="gap-1.5">
                        <Copy className="h-3.5 w-3.5" /> Copy link
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => revokeInvite(i.id)}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {canManage && (
        <PermissionsPanel
          orgId={orgId}
          members={members.map((m) => ({
            user_id: m.user_id,
            role: m.role,
            name: m.profile?.full_name ?? m.profile?.email ?? "Unknown",
          }))}
        />
      )}
    </div>
  );
}
