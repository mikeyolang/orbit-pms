import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  Users2,
  Settings,
  CheckSquare,
  FolderKanban,
  Bell,
  CalendarClock,
  ChevronDown,
  LogOut,
  Plus,
  FileText,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { postgres } from "@/integrations/postgres/client";
import {
  useAuthSession,
  useMemberships,
  getCurrentOrgId,
  membershipRoleLabel,
  isSigningOut,
  signOutAndRedirect,
  setCurrentOrgId,
  type OrgMembership,
} from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useMyPermissions } from "@/lib/permissions";

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { user, loading: sessionLoading } = useAuthSession();
  const { memberships, loading: memLoading, refresh } = useMemberships(user);
  const [currentOrg, setCurrentOrg] = useState<OrgMembership | null>(null);
  const [isSupportOnly, setIsSupportOnly] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { can: canCurrent } = useMyPermissions(currentOrg?.organization_id);

  useEffect(() => {
    if (memLoading || memberships.length === 0) return;
    const stored = getCurrentOrgId();
    const found = memberships.find((m) => m.organization_id === stored) ?? memberships[0];
    setCurrentOrg(found);
    setCurrentOrgId(found.organization_id);
  }, [memberships, memLoading]);

  const refreshSupport = useCallback(async () => {
    if (!user || !currentOrg) return;
    setIsSupportOnly(!!currentOrg.is_support_only);
  }, [user, currentOrg]);

  useEffect(() => {
    refreshSupport();
  }, [refreshSupport]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const loadUnread = async () => {
      const { data } = await postgres.from("system_notifications").select("id").eq("user_id", user.id).is("read_at", null);
      if (active) setUnreadNotifications((data ?? []).length);
    };
    void loadUnread();
    const timer = window.setInterval(loadUnread, 8000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user, pathname]);

  useEffect(() => {
    if (!signingOut && !isSigningOut() && !sessionLoading && !memLoading && memberships.length === 0) {
      navigate({ to: "/onboarding" });
    }
  }, [sessionLoading, memLoading, memberships, navigate, signingOut]);

  if (sessionLoading || memLoading || !currentOrg) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  const role = currentOrg.role;
  const roleLabel = membershipRoleLabel(currentOrg);
  const canManage = role === "owner" || role === "admin";

  const fullNav = [
    { to: "/app", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { to: "/app/projects", label: "Projects", icon: FolderKanban, exact: false },
    { to: "/app/shifts", label: "Shifts", icon: CalendarClock, exact: false },
    { to: "/app/shift-reports", label: "Shift Reports", icon: FileText, exact: false },
    { to: "/app/tasks", label: "My Tasks", icon: CheckSquare, exact: false },
    { to: "/app/teams", label: "Teams", icon: Users2, exact: false },
    { to: "/app/notifications", label: "Inbox", icon: Bell, exact: false },
    ...(canManage || canCurrent("members.invite") ? [{ to: "/app/team", label: "People & Roles", icon: Users, exact: false }] : []),
    { to: "/app/settings", label: "Settings", icon: Settings, exact: false },
  ];
  const supportNav = fullNav.filter((n) =>
    ["/app", "/app/shifts", "/app/shift-reports", "/app/tasks", "/app/settings"].includes(n.to),
  );
  const nav = (isSupportOnly ? supportNav : fullNav).filter((item) => {
    if (role === "owner" || role === "admin") return true;
    if (["/app/projects", "/app/tasks", "/app/teams"].includes(item.to)) return currentOrg.can_access_projects !== false;
    if (["/app/shifts", "/app/shift-reports"].includes(item.to)) return currentOrg.can_access_shifts !== false;
    return true;
  });

  // Route guard for support-only users
  const matchesNavItem = (item: (typeof nav)[number]) =>
    item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);

  const allowed = nav.some(matchesNavItem);
  if (!signingOut && !isSigningOut() && !allowed && !pathname.startsWith("/onboarding")) {
    navigate({ to: currentOrg.can_access_shifts !== false ? "/app/shifts" : "/app", replace: true });
  }

  async function signOut() {
    setSigningOut(true);
    await signOutAndRedirect();
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <aside className="hidden w-64 flex-col border-r border-white/10 bg-gradient-to-b from-[#1B3673] via-[#142A5C] to-slate-950 text-white shadow-xl md:flex">
        <div className="border-b border-white/10 p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2 rounded-lg p-2 text-left transition-colors hover:bg-white/10">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#1B3673] text-xs font-bold text-white shadow-lg shadow-slate-950/40">
                  {currentOrg.organization.name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">{currentOrg.organization.name}</div>
                  <div className="truncate text-xs text-indigo-200/75">{roleLabel}</div>
                </div>
                <ChevronDown className="h-4 w-4 text-indigo-200/75" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-60" align="start">
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {memberships.map((m) => (
                <DropdownMenuItem
                  key={m.organization_id}
                  onClick={() => {
                    setCurrentOrg(m);
                    setCurrentOrgId(m.organization_id);
                    toast.success(`Switched to ${m.organization.name}`);
                  }}
                >
                  <div className="grid h-5 w-5 place-items-center rounded bg-gradient-to-br from-primary to-primary/60 text-[10px] font-semibold text-primary-foreground">
                    {m.organization.name[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{m.organization.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{membershipRoleLabel(m)}</div>
                  </div>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => navigate({ to: "/onboarding", search: { mode: "additional" } })}
              >
                <Plus className="h-4 w-4" />
                Create workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {nav.map((item) => {
            const active = matchesNavItem(item);
            return (
              <Link
                key={item.to}
                to={item.to as never}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-all ${
                  active
                    ? "bg-red-600 text-white"
                    : "text-white hover:bg-white/10"
                }`}
              >
                <span className={`grid h-7 w-7 place-items-center rounded-md ${active ? "bg-red-700" : "bg-white/5 group-hover:bg-white/10"}`}>
                  <item.icon className="h-4 w-4" />
                </span>
                <span className="flex-1">{item.label}</span>
                {item.to === "/app/notifications" && unreadNotifications > 0 && (
                  <span className="min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-bold leading-none text-white">
                    {unreadNotifications > 99 ? "99+" : unreadNotifications}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[10px] uppercase tracking-wider text-indigo-200/60">
              Preferences
            </span>
            <ThemeToggle />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2 rounded-lg p-2 text-left transition-colors hover:bg-white/10">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-[#1B3673] text-xs font-bold text-white">
                  {user?.email?.[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white">
                    {user?.user_metadata?.full_name ?? user?.email}
                  </div>
                  <div className="truncate text-xs text-indigo-200/65">{user?.email}</div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={signOut} disabled={signingOut}>
                {signingOut ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <LogOut className="h-4 w-4" />}
                {signingOut ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <OrgContext.Provider value={{ currentOrg, role, refresh, isSupportOnly, refreshSupport }}>
          {children}
        </OrgContext.Provider>
      </main>
    </div>
  );
}

import { createContext, useContext } from "react";

export const OrgContext = createContext<{
  currentOrg: OrgMembership;
  role: OrgMembership["role"];
  refresh: () => Promise<void>;
  isSupportOnly: boolean;
  refreshSupport: () => Promise<void>;
} | null>(null);

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg outside AppShell");
  return ctx;
}
