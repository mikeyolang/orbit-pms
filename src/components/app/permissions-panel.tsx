import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { postgres } from "@/integrations/postgres/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Plus, RotateCcw, Search, ShieldCheck, Trash2 } from "lucide-react";
import type { OrgRole } from "@/lib/auth";
import {
  ASSIGNABLE_ROLES,
  PERMISSIONS,
  PERMISSION_GROUPS,
  defaultPermission,
  type AppPermission,
} from "@/lib/permissions";
import type { CustomRole } from "@/routes/_authenticated/app.team";

interface MemberLite {
  user_id: string;
  role: OrgRole;
  custom_role_id: string | null;
  name: string;
  email: string;
}

type RoleKey = `${OrgRole}:${AppPermission}`;

export function PermissionsPanel({ orgId, members, customRoles, onRolesChanged }: { orgId: string; members: MemberLite[]; customRoles: CustomRole[]; onRolesChanged: () => void | Promise<void> }) {
  const [roleRows, setRoleRows] = useState<Partial<Record<RoleKey, boolean>>>({});
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [customRows, setCustomRows] = useState<Record<string, boolean>>({});
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [personSearch, setPersonSearch] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleBase, setNewRoleBase] = useState<"manager" | "member" | "viewer">("member");

  const load = useCallback(async () => {
    setLoading(true);
    const [rp, mp, cp] = await Promise.all([
      postgres.from("role_permissions").select("role, permission, allowed").eq("organization_id", orgId),
      postgres.from("member_permissions").select("user_id, permission, allowed").eq("organization_id", orgId),
      customRoles.length ? postgres.from("custom_role_permissions").select("custom_role_id, permission, allowed").in("custom_role_id", customRoles.map((r) => r.id)) : Promise.resolve({ data: [] }),
    ]);
    const nextRoles: Record<string, boolean> = {};
    for (const r of rp.data ?? []) nextRoles[`${r.role}:${r.permission}`] = r.allowed;
    const nextOverrides: Record<string, boolean> = {};
    for (const m of mp.data ?? []) nextOverrides[`${m.user_id}:${m.permission}`] = m.allowed;
    setRoleRows(nextRoles as Partial<Record<RoleKey, boolean>>);
    setOverrides(nextOverrides);
    const nextCustom: Record<string, boolean> = {};
    for (const row of cp.data ?? []) nextCustom[`${row.custom_role_id}:${row.permission}`] = row.allowed;
    setCustomRows(nextCustom);
    setLoading(false);
  }, [customRoles, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const assignableMembers = useMemo(() => members.filter((m) => m.role !== "owner"), [members]);
  const currentMember = assignableMembers.find((m) => m.user_id === selectedUser);
  const visibleMembers = useMemo(() => {
    const query = personSearch.trim().toLowerCase();
    return assignableMembers.filter((m) => !query || m.name.toLowerCase().includes(query) || m.email.toLowerCase().includes(query));
  }, [assignableMembers, personSearch]);

  function roleValue(role: OrgRole, perm: AppPermission) {
    const key = `${role}:${perm}` as RoleKey;
    return key in roleRows ? roleRows[key] === true : defaultPermission(role, perm);
  }

  function customRoleValue(role: CustomRole, perm: AppPermission) {
    const key = `${role.id}:${perm}`;
    return key in customRows ? customRows[key] : roleValue(role.base_role, perm);
  }

  async function setCustomRolePermission(role: CustomRole, perm: AppPermission, allowed: boolean) {
    const key = `${role.id}:${perm}`;
    setCustomRows((prev) => ({ ...prev, [key]: allowed }));
    setSaving(key);
    const { error } = await postgres.from("custom_role_permissions").upsert(
      { custom_role_id: role.id, permission: perm, allowed },
      { onConflict: "custom_role_id,permission" },
    );
    setSaving(null);
    if (error) { toast.error(error.message); await load(); }
  }

  async function resetCustomRole(role: CustomRole) {
    const { error } = await postgres.from("custom_role_permissions").delete().eq("custom_role_id", role.id);
    if (error) return toast.error(error.message);
    toast.success(`${role.name} reset to ${role.base_role} defaults`);
    await load();
  }

  async function createCustomRole(e: React.FormEvent) {
    e.preventDefault();
    const name = newRoleName.trim();
    if (!name) return toast.error("Enter a role name");
    const { error } = await postgres.from("custom_roles").insert({ organization_id: orgId, name, base_role: newRoleBase, can_access_projects: true, can_access_shifts: true });
    if (error) return toast.error(error.message);
    setNewRoleName("");
    toast.success(`${name} role created`);
    await onRolesChanged();
  }

  async function deleteCustomRole(role: CustomRole) {
    if (!confirm(`Delete the ${role.name} role? Members will keep its ${role.base_role} access level.`)) return;
    const { error } = await postgres.from("custom_roles").delete().eq("id", role.id);
    if (error) return toast.error(error.message);
    toast.success("Custom role deleted");
    await onRolesChanged();
  }

  async function setRolePermission(role: OrgRole, perm: AppPermission, allowed: boolean) {
    const key = `${role}:${perm}` as RoleKey;
    setRoleRows((prev) => ({ ...prev, [key]: allowed }));
    setSaving(key);
    const { error } = await postgres
      .from("role_permissions")
      .upsert(
        { organization_id: orgId, role, permission: perm, allowed },
        { onConflict: "organization_id,role,permission" },
      );
    setSaving(null);
    if (error) {
      toast.error(error.message);
      await load();
    }
  }

  async function resetRole(role: OrgRole) {
    const { error } = await postgres.from("role_permissions").delete().eq("organization_id", orgId).eq("role", role);
    if (error) return toast.error(error.message);
    toast.success(`${role} reset to defaults`);
    await load();
  }

  async function setOverride(userId: string, perm: AppPermission, value: "default" | "allow" | "deny") {
    const key = `${userId}:${perm}`;
    setSaving(key);
    if (value === "default") {
      const { error } = await postgres
        .from("member_permissions")
        .delete()
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .eq("permission", perm);
      setSaving(null);
      if (error) return toast.error(error.message);
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    const allowed = value === "allow";
    const { error } = await postgres
      .from("member_permissions")
      .upsert(
        { organization_id: orgId, user_id: userId, permission: perm, allowed },
        { onConflict: "organization_id,user_id,permission" },
      );
    setSaving(null);
    if (error) return toast.error(error.message);
    setOverrides((prev) => ({ ...prev, [key]: allowed }));
  }

  if (loading) {
    return (
      <section className="mt-8 rounded-xl border border-border/60 bg-card/40 p-5">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-xl border border-border/60 bg-card/40 p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-medium">Permissions</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Set what each role can do, then fine-tune individual people. Owners always have full access.
      </p>

      <Tabs defaultValue="roles" className="mt-4">
        <TabsList>
          <TabsTrigger value="roles">By role</TabsTrigger>
          <TabsTrigger value="people">By person</TabsTrigger>
        </TabsList>

        <TabsContent value="roles" className="mt-4">
          <form onSubmit={createCustomRole} className="mb-4 grid gap-3 rounded-lg border border-border/60 p-4 sm:grid-cols-[1fr_180px_auto]">
            <div className="space-y-1.5"><Label>New role name</Label><Input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="e.g. Project coordinator" maxLength={60} /></div>
            <div className="space-y-1.5"><Label>Start with access from</Label><Select value={newRoleBase} onValueChange={(v) => setNewRoleBase(v as typeof newRoleBase)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manager">Manager</SelectItem><SelectItem value="member">Member</SelectItem><SelectItem value="viewer">Viewer</SelectItem></SelectContent></Select></div>
            <div className="flex items-end"><Button type="submit" className="w-full gap-1.5"><Plus className="h-4 w-4" /> Create role</Button></div>
          </form>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Capability</th>
                  {ASSIGNABLE_ROLES.map((role) => (
                    <th key={role} className="px-3 py-2 text-center font-medium capitalize">
                      {role}
                    </th>
                  ))}
                  {customRoles.map((role) => <th key={role.id} className="px-3 py-2 text-center font-medium">{role.name}<div className="font-normal text-[10px] capitalize">from {role.base_role}</div></th>)}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_GROUPS.map((group) => (
                  <Fragment key={group}>
                    <tr className="border-t border-border/60 bg-muted/20">
                      <td colSpan={ASSIGNABLE_ROLES.length + customRoles.length + 1} className="px-4 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                        {group}
                      </td>
                    </tr>
                    {PERMISSIONS.filter((p) => p.group === group).map((p) => (
                      <tr key={p.key} className="border-t border-border/60">
                        <td className="px-4 py-2.5">
                          <div className="font-medium">{p.label}</div>
                          <div className="text-xs text-muted-foreground">{p.description}</div>
                        </td>
                        {ASSIGNABLE_ROLES.map((role) => (
                          <td key={role} className="px-3 py-2.5 text-center">
                            <Switch
                              checked={roleValue(role, p.key)}
                              disabled={saving === `${role}:${p.key}`}
                              onCheckedChange={(v) => setRolePermission(role, p.key, v)}
                            />
                          </td>
                        ))}
                        {customRoles.map((role) => <td key={role.id} className="px-3 py-2.5 text-center"><Switch checked={customRoleValue(role, p.key)} disabled={saving === `${role.id}:${p.key}`} onCheckedChange={(v) => setCustomRolePermission(role, p.key, v)} /></td>)}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {ASSIGNABLE_ROLES.map((role) => (
              <Button key={role} size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={() => resetRole(role)}>
                <RotateCcw className="h-3 w-3" /> Reset {role}
              </Button>
            ))}
            {customRoles.map((role) => <div key={role.id} className="flex items-center"><Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={() => resetCustomRole(role)}><RotateCcw className="h-3 w-3" /> Reset {role.name}</Button><Button size="icon" variant="ghost" onClick={() => deleteCustomRole(role)} aria-label={`Delete ${role.name}`}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button></div>)}
          </div>
        </TabsContent>

        <TabsContent value="people" className="mt-4">
          <div className="max-w-md space-y-2">
            <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={personSearch} onChange={(e) => setPersonSearch(e.target.value)} placeholder="Search people by name or email" className="pl-9" /></div>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border/60 p-1">
              {visibleMembers.map((m) => <button key={m.user_id} type="button" onClick={() => setSelectedUser(m.user_id)} className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-muted ${selectedUser === m.user_id ? "bg-muted" : ""}`}><span><span className="block text-sm font-medium">{m.name}</span><span className="block text-xs text-muted-foreground">{m.email}</span></span><span className="text-xs capitalize text-muted-foreground">{customRoles.find((r) => r.id === m.custom_role_id)?.name ?? m.role}</span></button>)}
              {!visibleMembers.length && <p className="p-3 text-sm text-muted-foreground">No people match your search.</p>}
            </div>
          </div>

          {currentMember ? (
            <div className="mt-4 space-y-1.5">
              {PERMISSIONS.map((p) => {
                const key = `${currentMember.user_id}:${p.key}`;
                const override = key in overrides ? (overrides[key] ? "allow" : "deny") : "default";
                const customRole = customRoles.find((r) => r.id === currentMember.custom_role_id);
                const inherited = customRole ? customRoleValue(customRole, p.key) : roleValue(currentMember.role, p.key);
                return (
                  <div key={p.key} className="flex items-center gap-3 rounded-lg border border-border/60 bg-background p-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{p.label}</div>
                      <div className="text-xs text-muted-foreground">
                        Role default ({customRole?.name ?? currentMember.role}): {inherited ? "allowed" : "blocked"}
                      </div>
                    </div>
                    <Select
                      value={override}
                      onValueChange={(v) => setOverride(currentMember.user_id, p.key, v as "default" | "allow" | "deny")}
                    >
                      <SelectTrigger className="h-8 w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Use role default</SelectItem>
                        <SelectItem value="allow">Always allow</SelectItem>
                        <SelectItem value="deny">Always block</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Select a person to override their role defaults.</p>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}
