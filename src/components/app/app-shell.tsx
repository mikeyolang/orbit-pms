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
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { authClient } from "@/lib/auth-client";
import {
  useAuthSession,
  useMemberships,
  getCurrentOrgId,
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

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { user, loading: sessionLoading } = useAuthSession();
  const { memberships, loading: memLoading, refresh } = useMemberships(user);
  const [currentOrg, setCurrentOrg] = useState<OrgMembership | null>(null);
  const [isSupportOnly, setIsSupportOnly] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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
    if (!sessionLoading && !memLoading && memberships.length === 0) {
      navigate({ to: "/onboarding" });
    }
  }, [sessionLoading, memLoading, memberships, navigate]);

  if (sessionLoading || memLoading || !currentOrg) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  const role = currentOrg.role;
  const canManage = role === "owner" || role === "admin";

  const fullNav = [
    { to: "/app", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { to: "/app/shifts", label: "Shifts", icon: CalendarClock, exact: false },
    { to: "/app/projects", label: "Projects", icon: FolderKanban, exact: false },
    { to: "/app/tasks", label: "My Tasks", icon: CheckSquare, exact: false },
    { to: "/app/teams", label: "Teams", icon: Users2, exact: false },
    { to: "/app/notifications", label: "Inbox", icon: Bell, exact: false },
    ...(canManage ? [{ to: "/app/team", label: "People & Roles", icon: Users, exact: false }] : []),
    { to: "/app/settings", label: "Settings", icon: Settings, exact: false },
  ];
  const supportNav = fullNav.filter((n) =>
    ["/app", "/app/shifts", "/app/tasks", "/app/settings"].includes(n.to),
  );
  const nav = isSupportOnly ? supportNav : fullNav;

  // Route guard for support-only users
  const allowed = nav.some((n) => (n.exact ? pathname === n.to : pathname.startsWith(n.to)));
  if (isSupportOnly && !allowed && !pathname.startsWith("/onboarding")) {
    navigate({ to: "/app/shifts", replace: true });
  }

  async function signOut() {
    await authClient.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <aside className="hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="border-b border-sidebar-border p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-sidebar-accent">
                <div className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-xs font-semibold text-primary-foreground">
                  {currentOrg.organization.name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{currentOrg.organization.name}</div>
                  <div className="truncate text-xs text-muted-foreground capitalize">{role}</div>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
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
                  <span className="truncate">{m.organization.name}</span>
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

        <nav className="flex-1 space-y-0.5 p-2">
          {nav.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to as never}
                className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-2">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Preferences
            </span>
            <ThemeToggle />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-sidebar-accent">
                <div className="grid h-7 w-7 place-items-center rounded-full bg-accent text-xs font-medium">
                  {user?.email?.[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {user?.user_metadata?.full_name ?? user?.email}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="h-4 w-4" />
                Sign out
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
