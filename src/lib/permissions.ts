import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { OrgRole } from "@/lib/auth";

export type AppPermission =
  | "workspace.manage"
  | "members.invite"
  | "members.manage"
  | "projects.read"
  | "projects.write"
  | "tasks.read"
  | "tasks.write"
  | "tasks.assign"
  | "shifts.read"
  | "shifts.write"
  | "shifts.approve"
  | "reports.view";

export interface PermissionMeta {
  key: AppPermission;
  label: string;
  description: string;
  group: "Workspace" | "People" | "Projects" | "Tasks" | "Shifts";
}

export const PERMISSIONS: PermissionMeta[] = [
  { key: "workspace.manage", label: "Manage workspace", description: "Rename the workspace, change settings and join code.", group: "Workspace" },
  { key: "reports.view", label: "View reports", description: "Access the executive dashboard and analytics.", group: "Workspace" },
  { key: "members.invite", label: "Invite people", description: "Send invitations and share the join code.", group: "People" },
  { key: "members.manage", label: "Manage members", description: "Change roles, permissions, and remove members.", group: "People" },
  { key: "projects.read", label: "View projects", description: "Read projects, boards and milestones.", group: "Projects" },
  { key: "projects.write", label: "Create & edit projects", description: "Create projects, sprints and milestones.", group: "Projects" },
  { key: "tasks.read", label: "View tasks", description: "Read tasks and comments.", group: "Tasks" },
  { key: "tasks.write", label: "Create & edit tasks", description: "Create, edit, move and comment on tasks.", group: "Tasks" },
  { key: "tasks.assign", label: "Assign tasks", description: "Assign work to other people.", group: "Tasks" },
  { key: "shifts.read", label: "View shifts", description: "See the rota and their own shifts.", group: "Shifts" },
  { key: "shifts.write", label: "Schedule shifts", description: "Create, edit and drag shifts on the calendar.", group: "Shifts" },
  { key: "shifts.approve", label: "Approve swaps", description: "Approve or decline shift swap requests.", group: "Shifts" },
];

export const PERMISSION_GROUPS = ["Workspace", "People", "Projects", "Tasks", "Shifts"] as const;

export const ASSIGNABLE_ROLES: OrgRole[] = ["admin", "manager", "member", "viewer"];

export function defaultPermission(role: OrgRole, perm: AppPermission): boolean {
  if (role === "owner" || role === "admin") return true;
  if (role === "manager") return perm !== "workspace.manage" && perm !== "members.manage";
  if (role === "member")
    return ["projects.read", "tasks.read", "tasks.write", "shifts.read", "reports.view"].includes(perm);
  return ["projects.read", "tasks.read", "shifts.read"].includes(perm);
}

export type PermissionMap = Partial<Record<AppPermission, boolean>>;

/** Effective permissions of the signed-in user for an organization. */
export function useMyPermissions(orgId: string | null | undefined) {
  const [map, setMap] = useState<PermissionMap>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!orgId) {
      setMap({});
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase.rpc("my_permissions", { _org: orgId });
    const next: PermissionMap = {};
    for (const row of (data ?? []) as { permission: AppPermission; allowed: boolean }[]) {
      next[row.permission] = row.allowed;
    }
    setMap(next);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const can = useMemo(() => (perm: AppPermission) => map[perm] === true, [map]);

  return { permissions: map, can, loading, refresh };
}
