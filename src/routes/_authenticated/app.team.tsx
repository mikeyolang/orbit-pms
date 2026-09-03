import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { postgres } from "@/integrations/postgres/client";
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
import { Copy, Loader2, Mail, Trash2, UserPlus } from "lucide-react";
import type { OrgRole } from "@/lib/auth";
import { PermissionsPanel } from "@/components/app/permissions-panel";

export const Route = createFileRoute("/_authenticated/app/team")({
  component: TeamPage,
});

const ROLES: OrgRole[] = ["owner", "admin", "manager", "member", "viewer"];

interface Member {
  id: string;
  user_id: string;
  role: OrgRole;
  custom_role_id: string | null;
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
  declined_at: string | null;
  revoked_at: string | null;
  custom_role_id: string | null;
}

export interface CustomRole {
  id: string;
  name: string;
  description: string | null;
  base_role: Exclude<OrgRole, "owner" | "admin">;
}

function TeamPage() {
  const { currentOrg, role: myRole } = useOrg();
  const orgId = currentOrg.organization_id;
  const canManage = myRole === "owner" || myRole === "admin";

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("base:member");
  const [inviting, setInviting] = useState(false);
  const inviteSectionRef = useRef<HTMLElement>(null);
  const inviteEmailRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [m, i, r] = await Promise.all([
      postgres
        .from("organization_members")
        .select("id, user_id, role, custom_role_id, is_support_only, profile:profiles(full_name, email)")
        .eq("organization_id", orgId),
      postgres
        .from("invitations")
        .select("id, email, role, token, code, expires_at, accepted_at, declined_at, revoked_at, custom_role_id")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false }),
      postgres.from("custom_roles").select("id, name, description, base_role").eq("organization_id", orgId).order("name"),
    ]);
    if (m.data) setMembers(m.data as unknown as Member[]);
    if (i.data) setInvites(i.data as unknown as Invitation[]);
    if (r.data) setCustomRoles(r.data as unknown as CustomRole[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeRole(memberId: string, selection: string) {
    const custom = selection.startsWith("custom:") ? customRoles.find((r) => r.id === selection.slice(7)) : null;
    const role = (custom?.base_role ?? selection.replace("base:", "")) as OrgRole;
    const { error } = await postgres.from("organization_members").update({ role, custom_role_id: custom?.id ?? null }).eq("id", memberId);
    if (error) return toast.error(error.message);
    toast.success("Role updated");
    load();
  }

  async function toggleSupport(memberId: string, value: boolean) {
    const { error } = await postgres.from("organization_members").update({ is_support_only: value }).eq("id", memberId);
    if (error) return toast.error(error.message);
    toast.success(value ? "Set to support-only" : "Full access restored");
    load();
  }

  async function removeMember(memberId: string) {

    if (!confirm("Remove this member from the workspace?")) return;
    const { error } = await postgres.from("organization_members").delete().eq("id", memberId);
    if (error) return toast.error(error.message);
    toast.success("Member removed");
    load();
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.string().email().safeParse(inviteEmail.trim());
    if (!parsed.success) return toast.error("Enter a valid email");
    setInviting(true);
    const { data: user } = await postgres.auth.getUser();
    const custom = inviteRole.startsWith("custom:") ? customRoles.find((r) => r.id === inviteRole.slice(7)) : null;
    const { error } = await postgres.from("invitations").insert({
      organization_id: orgId,
      email: parsed.data,
      role: custom?.base_role ?? inviteRole.replace("base:", ""),
      custom_role_id: custom?.id ?? null,
      invited_by: user.user!.id,
    });
    setInviting(false);
    if (error) return toast.error(error.message);
    setInviteEmail("");
    toast.success("Invitation sent by email");
    load();
  }

  async function revokeInvite(id: string) {
    if (!confirm("Revoke this invitation? Its link will stop working.")) return;
    const { error } = await postgres.from("invitations").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Invitation revoked");
    load();
  }

  function inviteStatus(invite: Invitation) {
    if (invite.accepted_at) return "Accepted";
    if (invite.revoked_at) return "Revoked";
    if (invite.declined_at) return "Declined";
    if (new Date(invite.expires_at) <= new Date()) return "Expired";
    return "Pending";
  }

  const roleName = (role: OrgRole, customRoleId: string | null) => customRoles.find((r) => r.id === customRoleId)?.name ?? role;

  function copyInviteLink(token: string) {
    const url = `${window.location.origin}/accept-invite/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Invite link copied");
  }

  function openInviteForm() {
    inviteSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => inviteEmailRef.current?.focus(), 350);
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">People & Roles</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage who can access {currentOrg.organization.name}.</p>
      </div>

      {canManage && (
        <section ref={inviteSectionRef} className="mt-8 rounded-xl border border-border/60 bg-card/40 p-5">
          <h2 className="text-sm font-medium">Invite a teammate</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Send a secure invite link. They'll create an account (or sign in) and join with the role you choose.
          </p>
          <form onSubmit={sendInvite} className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input ref={inviteEmailRef} type="email" placeholder="teammate@company.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.filter((r) => r !== "owner").map((r) => (
                      <SelectItem key={r} value={`base:${r}`} className="capitalize">{r}</SelectItem>
                    ))}
                  {customRoles.map((r) => <SelectItem key={r.id} value={`custom:${r.id}`}>{r.name}</SelectItem>)}
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

      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Members ({members.length})</h2>
          {canManage && <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={openInviteForm}><UserPlus className="h-4 w-4" /> Invite member</Button>}
        </div>
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
                        <Select value={m.custom_role_id ? `custom:${m.custom_role_id}` : `base:${m.role}`} onValueChange={(v) => changeRole(m.id, v)}>
                          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ROLES.filter((r) => r !== "owner").map((r) => (
                              <SelectItem key={r} value={`base:${r}`} className="capitalize">{r}</SelectItem>
                            ))}
                            {customRoles.map((r) => <SelectItem key={r.id} value={`custom:${r.id}`}>{r.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs capitalize">{roleName(m.role, m.custom_role_id)}</span>
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
          <h2 className="text-sm font-medium">Invitation history ({invites.length})</h2>
          <div className="mt-3 overflow-hidden rounded-xl border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Email</th>
                  <th className="px-4 py-2 text-left font-medium">Role</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Expires</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id} className="border-t border-border/60">
                    <td className="px-4 py-2.5">{i.email}</td>
                    <td className="px-4 py-2.5 capitalize">{roleName(i.role, i.custom_role_id)}</td>
                    <td className="px-4 py-2.5"><span className="rounded-full bg-muted px-2.5 py-1 text-xs">{inviteStatus(i)}</span></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{new Date(i.expires_at).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 text-right space-x-1">
                      {inviteStatus(i) === "Pending" && <><Button variant="ghost" size="sm" onClick={() => copyInviteLink(i.token)} className="gap-1.5"><Copy className="h-3.5 w-3.5" /> Copy link</Button><Button variant="ghost" size="sm" onClick={() => revokeInvite(i.id)} className="text-destructive">Revoke</Button></>}
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
          customRoles={customRoles}
          onRolesChanged={load}
          members={members.map((m) => ({
            user_id: m.user_id,
            role: m.role,
            custom_role_id: m.custom_role_id,
            name: m.profile?.full_name ?? m.profile?.email ?? "Unknown",
            email: m.profile?.email ?? "",
          }))}
        />
      )}
    </div>
  );
}
