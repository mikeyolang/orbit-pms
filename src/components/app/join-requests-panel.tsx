import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Check, Loader2, UserPlus, X } from "lucide-react";
import type { OrgRole } from "@/lib/auth";
import { ASSIGNABLE_ROLES } from "@/lib/permissions";

interface JoinRequest {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  message: string | null;
  created_at: string;
}

export function JoinRequestsPanel({ orgId, onChanged }: { orgId: string; onChanged: () => void }) {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<Record<string, OrgRole>>({});
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("join_requests")
      .select("id, user_id, email, full_name, message, created_at")
      .eq("organization_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setRequests((data ?? []) as JoinRequest[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: string, approve: boolean) {
    setWorking(id);
    const { error } = await supabase.rpc("decide_join_request", {
      _request_id: id,
      _approve: approve,
      _role: (roles[id] ?? "member") as OrgRole,
    });
    setWorking(null);
    if (error) return toast.error(error.message.replace(/^.*?:\s*/, ""));
    toast.success(approve ? "Member approved" : "Request declined");
    await load();
    onChanged();
  }

  if (loading) return null;

  return (
    <section className="mt-8 rounded-xl border border-border/60 bg-card/40 p-5">
      <div className="flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-medium">Join requests ({requests.length})</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        People who used the workspace code without an email invitation land here for approval.
      </p>

      {requests.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No pending join requests
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {requests.map((r) => (
            <div key={r.id} className="rounded-lg border border-border/60 bg-background p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.full_name ?? r.email}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.email}</div>
                </div>
                <Select
                  value={roles[r.id] ?? "member"}
                  onValueChange={(v) => setRoles((prev) => ({ ...prev, [r.id]: v as OrgRole }))}
                >
                  <SelectTrigger className="h-8 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((role) => (
                      <SelectItem key={role} value={role} className="capitalize">
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-1.5">
                  <Button size="sm" className="gap-1.5" disabled={working === r.id} onClick={() => decide(r.id, true)}>
                    {working === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={working === r.id} onClick={() => decide(r.id, false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {r.message && <p className="mt-2 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">{r.message}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
