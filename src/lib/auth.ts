import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type OrgRole = "owner" | "admin" | "manager" | "member" | "viewer";

export interface OrgMembership {
  organization_id: string;
  role: OrgRole;
  organization: { id: string; name: string; slug: string; invite_code?: string | null };
}

export function useAuthSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}

export function useMemberships(user: User | null) {
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
    const { data, error } = await supabase
      .from("organization_members")
      .select("organization_id, role, organization:organizations(id, name, slug, invite_code)")
      .eq("user_id", user.id);
    if (!error && data) {
      const rank: Record<OrgRole, number> = { owner: 5, admin: 4, manager: 3, member: 2, viewer: 1 };
      const byOrg = new Map<string, OrgMembership>();
      for (const row of data as unknown as OrgMembership[]) {
        const existing = byOrg.get(row.organization_id);
        if (!existing || rank[row.role] > rank[existing.role]) byOrg.set(row.organization_id, row);
      }
      setMemberships(Array.from(byOrg.values()));
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
export function getCurrentOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(CURRENT_ORG_KEY);
}
export function setCurrentOrgId(id: string) {
  if (typeof window !== "undefined") localStorage.setItem(CURRENT_ORG_KEY, id);
}
