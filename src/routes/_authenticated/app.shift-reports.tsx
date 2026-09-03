import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { useOrg } from "@/components/app/app-shell";
import { ShiftReportsPanel } from "@/components/shifts/shift-reports-panel";
import { postgres } from "@/integrations/postgres/client";
import { useMyPermissions } from "@/lib/permissions";

export const Route = createFileRoute("/_authenticated/app/shift-reports")({ component: ShiftReportsPage });

interface Member { user_id: string; full_name: string | null; email: string | null }

function ShiftReportsPage() {
  const { currentOrg, role } = useOrg();
  const orgId = currentOrg.organization_id;
  const { can, loading: permissionsLoading } = useMyPermissions(orgId);
  const canViewTeam = role === "owner" || role === "admin" || can("shifts.approve");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadMembers() {
      setLoading(true);
      if (!canViewTeam) { if (!cancelled) { setMembers([]); setLoading(false); } return; }
      const { data: memberships } = await postgres.from("organization_members").select("user_id").eq("organization_id", orgId);
      const ids = [...new Set(((memberships ?? []) as { user_id: string }[]).map((item) => item.user_id))];
      const { data: profiles } = ids.length ? await postgres.from("profiles").select("id,full_name,email").in("id", ids) : { data: [] };
      if (!cancelled) {
        setMembers(((profiles ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((profile) => ({ user_id: profile.id, full_name: profile.full_name, email: profile.email })));
        setLoading(false);
      }
    }
    if (!permissionsLoading) void loadMembers();
    return () => { cancelled = true; };
  }, [orgId, canViewTeam, permissionsLoading]);

  return <div className="mx-auto max-w-7xl space-y-5 px-6 py-6">
    <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10"><FileText className="h-5 w-5 text-primary" /></div><div><h1 className="text-2xl font-semibold tracking-tight">Shift Reports</h1><p className="text-sm text-muted-foreground">Performance trends and completed shift records for {currentOrg.organization.name}.</p></div></div>
    {loading || permissionsLoading ? <div className="grid min-h-64 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : <ShiftReportsPanel orgId={orgId} members={members} canManage={canViewTeam} />}
  </div>;
}
