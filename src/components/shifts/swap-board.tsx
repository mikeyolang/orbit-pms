import { postgres } from "@/integrations/postgres/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { toast } from "sonner";
import { Check, X, HandHeart } from "lucide-react";
import { format } from "date-fns";
import { colorForUser, initials, type SwapRequest, type Shift, type ShiftType } from "@/lib/shifts";

type Enriched = SwapRequest & {
  from_shift?: Shift & { shift_type?: ShiftType | null } | null;
  from_profile?: { full_name: string | null; email: string | null } | null;
  preferred_start_at?: string | null;
  preferred_end_at?: string | null;
};
type Member = { user_id: string; full_name: string | null; email: string | null };

export function SwapBoard({
  requests, currentUserId, isManager, members, onChange,
}: {
  requests: Enriched[];
  currentUserId: string;
  isManager: boolean;
  members: Member[];
  onChange: () => void;
}) {
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const openRequests = requests.filter((r) => r.status === "pending" || r.status === "approved");
  if (openRequests.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-4 text-center text-sm text-muted-foreground">
        <HandHeart className="mx-auto mb-1 h-5 w-5 opacity-60" />
        No open swap requests. Drag a shift here or use "Request swap" from your card.
      </div>
    );
  }

  async function accept(r: Enriched) {
    const assignee = r.kind === "coverage" ? assignees[r.id] : null;
    if (r.kind === "coverage" && !assignee) return toast.error("Choose who will take the shift");
    const { error } = await postgres.rpc("apply_shift_swap", { _request_id: r.id, _assignee_id: assignee });
    if (error) return toast.error(error.message);
    toast.success("Swap applied");
    onChange();
  }
  async function decline(r: Enriched) {
    const { error } = await postgres
      .from("shift_swap_requests")
      .update({ status: "declined", decided_by: currentUserId, decided_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    onChange();
  }
  async function cancel(r: Enriched) {
    const { error } = await postgres
      .from("shift_swap_requests")
      .update({ status: "cancelled" })
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    onChange();
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <HandHeart className="h-4 w-4 text-primary" />
        Swap board · {openRequests.length}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {openRequests.map((r) => {
          const canRespond =
            (r.kind === "direct" && r.to_user_id === currentUserId) ||
            (r.kind === "open" && r.from_user_id !== currentUserId) ||
            (r.kind === "coverage" && isManager);
          const isMine = r.from_user_id === currentUserId;
          const name = r.from_profile?.full_name ?? r.from_profile?.email ?? "Someone";
          return (
            <div key={r.id} className="min-w-[240px] rounded-lg border border-border bg-background p-3 text-xs">
              <div className="flex items-center gap-2">
                <div className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-white"
                     style={{ background: colorForUser(r.from_user_id) }}>
                  {initials(name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{name}</div>
                  <div className="text-muted-foreground capitalize">{r.kind}</div>
                </div>
              </div>
              {r.from_shift && (
                <div className="mt-2 rounded-md px-2 py-1 text-[11px]"
                     style={{ background: (r.from_shift.shift_type?.color ?? "#6366f1") + "22", color: r.from_shift.shift_type?.color ?? undefined }}>
                  {r.from_shift.shift_type?.label ?? "Shift"} · {format(new Date(r.from_shift.start_at), "MMM d, HH:mm")}
                </div>
              )}
              {r.preferred_start_at && r.preferred_end_at && <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5"><div className="text-[10px] uppercase text-muted-foreground">Requested change</div><div>{format(new Date(r.preferred_start_at), "MMM d, HH:mm")} – {format(new Date(r.preferred_end_at), "MMM d, HH:mm")}</div></div>}
              {r.reason && <div className="mt-2 text-muted-foreground line-clamp-2">"{r.reason}"</div>}
              <div className="mt-2 flex gap-1">
                {canRespond && r.kind === "coverage" && <Select value={assignees[r.id] ?? ""} onValueChange={(v) => setAssignees((old) => ({ ...old, [r.id]: v }))}><SelectTrigger className="h-7 flex-1"><SelectValue placeholder="Assign member" /></SelectTrigger><SelectContent>{members.filter((m) => m.user_id !== r.from_user_id).map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.full_name ?? m.email}</SelectItem>)}</SelectContent></Select>}
                {canRespond && (
                  <Button size="sm" className="h-7 flex-1 gap-1" onClick={() => accept(r)}>
                    <Check className="h-3 w-3" /> Accept
                  </Button>
                )}
                {canRespond && r.kind !== "open" && (
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => decline(r)}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
                {isMine && (
                  <Button size="sm" variant="ghost" className="h-7 flex-1" onClick={() => cancel(r)}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
