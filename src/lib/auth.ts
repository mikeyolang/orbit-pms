import { useEffect, useState, useCallback } from "react";
import { authClient } from "@/lib/auth-client";
import { getMyMemberships } from "@/lib/api/session.functions";

export type OrgRole = "owner" | "admin" | "manager" | "member" | "viewer";

export interface OrgMembership {
  organization_id: string;
  role: OrgRole;
  custom_role_name?: string | null;
  organization: { id: string; name: string; slug: string; invite_code?: string | null };
  is_support_only?: boolean;
  can_access_projects?: boolean;
  can_access_shifts?: boolean;
}

export function membershipRoleLabel(membership: Pick<OrgMembership, "role" | "custom_role_name">) {
  if (membership.custom_role_name?.trim()) return membership.custom_role_name.trim();
  return membership.role.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export type AppUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
};

export function useAuthSession() {
  const session = authClient.useSession();
  return {
    session: session.data ?? null,
    user: session.data?.user ?? null,
    loading: session.isPending,
  };
}

export function useMemberships(user: AppUser | null) {
  const [memberships, setMemberships] = useState<OrgMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedForUserId, setLoadedForUserId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setMemberships([]);
      setLoadedForUserId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getMyMemberships();
      const rank: Record<OrgRole, number> = {
        owner: 5,
        admin: 4,
        manager: 3,
        member: 2,
        viewer: 1,
      };
      const byOrg = new Map<string, OrgMembership>();
      for (const row of data as unknown as OrgMembership[]) {
        const existing = byOrg.get(row.organization_id);
        if (!existing || rank[row.role] > rank[existing.role]) byOrg.set(row.organization_id, row);
      }
      setMemberships(Array.from(byOrg.values()));
    } catch {
      setMemberships([]);
    }
    setLoadedForUserId(user.id);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { memberships, loading: loading || (!!user && loadedForUserId !== user.id), refresh };
}

const CURRENT_ORG_KEY = "current_org_id";
let signOutInProgress = false;

export function isSigningOut() {
  return signOutInProgress;
}

export async function signOutAndRedirect() {
  if (signOutInProgress) return;
  signOutInProgress = true;
  try {
    await authClient.signOut();
  } finally {
    if (typeof window !== "undefined") {
      localStorage.removeItem(CURRENT_ORG_KEY);
      window.location.replace("/auth");
    }
  }
}

export function getCurrentOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(CURRENT_ORG_KEY);
}
export function setCurrentOrgId(id: string) {
  if (typeof window !== "undefined") localStorage.setItem(CURRENT_ORG_KEY, id);
}
