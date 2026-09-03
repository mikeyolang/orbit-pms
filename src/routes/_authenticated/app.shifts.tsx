import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSession } from "@/lib/auth";
import { useOrg } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CalendarPlus, Copy, Loader2, Play, StopCircle, MessageSquareQuote } from "lucide-react";
import { format } from "date-fns";
import { ShiftCalendar } from "@/components/shifts/shift-calendar";
import { ShiftCreateDialog } from "@/components/shifts/shift-create-dialog";
import { EndShiftDialog } from "@/components/shifts/end-shift-dialog";
import { SwapBoard } from "@/components/shifts/swap-board";
import { SwapRequestDialog } from "@/components/shifts/swap-request-dialog";
import {
  colorForUser, initials, isOnShiftNow, dayShiftAtRange,
  type Shift, type ShiftType, type SwapRequest, type ShiftSettings,
} from "@/lib/shifts";

export const Route = createFileRoute("/_authenticated/app/shifts")({
  component: ShiftsPage,
});

interface Member { user_id: string; full_name: string | null; email: string | null }
type ShiftFull = Shift & { shift_type?: ShiftType | null };

function ShiftsPage() {
  const { user } = useAuthSession();
  const { currentOrg, role } = useOrg();
  const orgId = currentOrg.organization_id;
  const canManage = role === "owner" || role === "admin" || role === "manager";

  const [cursor, setCursor] = useState(new Date());
  const [shifts, setShifts] = useState<ShiftFull[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [swaps, setSwaps] = useState<(SwapRequest & { from_shift?: ShiftFull | null; from_profile?: { full_name: string | null; email: string | null } | null })[]>([]);
  const [settings, setSettings] = useState<ShiftSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<{ userId?: string; date?: Date; shiftTypeId?: string }>({});
  const [detail, setDetail] = useState<ShiftFull | null>(null);
  const [endTarget, setEndTarget] = useState<string | null>(null);
  const [swapTarget, setSwapTarget] = useState<ShiftFull | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1).toISOString();
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 2, 0).toISOString();
    const [t, s, m, sw, cfg] = await Promise.all([
      supabase.from("shift_types").select("*").eq("organization_id", orgId).order("sort_order"),
      supabase.from("shifts").select("*, shift_type:shift_types(*)").eq("organization_id", orgId)
        .gte("start_at", monthStart).lte("start_at", monthEnd).order("start_at"),
      supabase.from("organization_members").select("user_id").eq("organization_id", orgId),
      supabase.from("shift_swap_requests").select("*, from_shift:shifts!from_shift_id(*, shift_type:shift_types(*))")
        .eq("organization_id", orgId).in("status", ["pending", "approved"]),
      supabase.from("shift_settings").select("*").eq("organization_id", orgId).maybeSingle(),
    ]);
    setSettings((cfg.data as ShiftSettings) ?? null);
    setShiftTypes((t.data as ShiftType[]) ?? []);
    setShifts((s.data as ShiftFull[]) ?? []);
    const memberIds = Array.from(
      new Set(((m.data as { user_id: string }[]) ?? []).map((x) => x.user_id)),
    );
    let profileMap: Record<string, { full_name: string | null; email: string | null }> = {};
    if (memberIds.length) {
      const { data: profs } = await supabase
        .from("profiles").select("id, full_name, email").in("id", memberIds);
      profileMap = Object.fromEntries(
        ((profs as { id: string; full_name: string | null; email: string | null }[]) ?? [])
          .map((p) => [p.id, { full_name: p.full_name, email: p.email }]),
      );
    }
    const mem = memberIds.map((id) => ({
      user_id: id,
      full_name: profileMap[id]?.full_name ?? null,
      email: profileMap[id]?.email ?? null,
    }));
    setMembers(mem);
    // enrich swaps with profile
    const swapData = (sw.data as unknown as (SwapRequest & { from_shift?: ShiftFull | null })[]) ?? [];
    const enriched = swapData.map((r) => ({
      ...r,
      from_profile: mem.find((mm) => mm.user_id === r.from_user_id) ?? null,
    }));
    setSwaps(enriched);
    setLoading(false);
  }, [orgId, cursor]);

  useEffect(() => { load(); }, [load]);

  function openCreate(day?: Date, userId?: string, shiftTypeId?: string) {
    setCreateDefaults({ date: day, userId, shiftTypeId });
    setCreateOpen(true);
  }

  async function copyPreviousMonth() {
    const prevStart = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    const prevEnd = new Date(cursor.getFullYear(), cursor.getMonth(), 0, 23, 59, 59);
    const { data: prev } = await supabase.from("shifts")
      .select("*, shift_type:shift_types(*)")
      .eq("organization_id", orgId)
      .gte("start_at", prevStart.toISOString())
      .lte("start_at", prevEnd.toISOString());
    if (!prev || prev.length === 0) return toast.info("Nothing to copy from the previous month");
    const { data: u } = await supabase.auth.getUser();
    const rows = (prev as ShiftFull[]).map((s) => {
      const t = s.shift_type;
      const src = new Date(s.start_at);
      const nextDay = new Date(cursor.getFullYear(), cursor.getMonth(), src.getDate());
      const { start_at, end_at } = t ? dayShiftAtRange(nextDay, t.start_time, t.end_time)
        : { start_at: nextDay.toISOString(), end_at: new Date(nextDay.getTime() + 8 * 3600 * 1000).toISOString() };
      return {
        organization_id: orgId, user_id: s.user_id, shift_type_id: s.shift_type_id,
        start_at, end_at, notes: s.notes, created_by: u.user?.id ?? null,
      };
    });
    const { error } = await supabase.from("shifts").insert(rows);
    if (error) return toast.error(error.message);
    toast.success(`Copied ${rows.length} shifts to ${format(cursor, "MMMM yyyy")}`);
    load();
  }

  const myUpcoming = useMemo(() => shifts
    .filter((s) => s.user_id === user?.id && new Date(s.end_at).getTime() > Date.now() && s.status !== "ended" && s.status !== "cancelled")
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()), [shifts, user?.id]);
  const restricted = !canManage && settings?.members_see_all_shifts === false;
  const visibleShifts = useMemo(
    () => (restricted ? shifts.filter((s) => s.user_id === user?.id) : shifts),
    [restricted, shifts, user?.id],
  );
  const visibleMembers = useMemo(
    () => (restricted ? members.filter((m) => m.user_id === user?.id) : members),
    [restricted, members, user?.id],
  );
  const activeNow = myUpcoming.find((s) => isOnShiftNow(s));

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shifts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Rota, coverage, and swap requests for {currentOrg.organization.name}.</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button size="sm" variant="outline" onClick={copyPreviousMonth}>
              <Copy className="h-4 w-4" /> Copy previous month
            </Button>
          )}
          {canManage && (
            <Button size="sm" onClick={() => openCreate(new Date())}>
              <CalendarPlus className="h-4 w-4" /> Create shift
            </Button>
          )}
        </div>
      </div>

      {activeNow && (
        <div className="flex items-center justify-between rounded-xl border border-primary/40 bg-primary/5 p-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-full text-xs font-semibold text-white"
                 style={{ background: activeNow.shift_type?.color ?? "#6366f1" }}>
              <Play className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-medium">You're on shift: {activeNow.shift_type?.label}</div>
              <div className="text-xs text-muted-foreground">
                Ends {format(new Date(activeNow.end_at), "HH:mm")} today
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setSwapTarget(activeNow)}>
              <MessageSquareQuote className="h-4 w-4" /> Request swap
            </Button>
            <Button size="sm" onClick={() => setEndTarget(activeNow.id)}>
              <StopCircle className="h-4 w-4" /> End shift
            </Button>
          </div>
        </div>
      )}

      <SwapBoard requests={swaps} currentUserId={user?.id ?? ""} isManager={canManage} onChange={load} />

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <ShiftCalendar
          cursor={cursor}
          onCursor={setCursor}
          shifts={visibleShifts}
          shiftTypes={shiftTypes}
          members={visibleMembers}
          canManage={canManage}
          currentUserId={user?.id ?? ""}
          onCreateAt={openCreate}
          onShiftClick={setDetail}
          onReload={load}
        />
      )}

      <ShiftCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        orgId={orgId}
        members={members}
        shiftTypes={shiftTypes}
        defaults={createDefaults}
        onCreated={load}
      />

      {endTarget && (
        <EndShiftDialog open={!!endTarget} onOpenChange={(v) => !v && setEndTarget(null)} shiftId={endTarget} onEnded={load} />
      )}

      {swapTarget && user && (
        <SwapRequestDialog
          open={!!swapTarget}
          onOpenChange={(v) => !v && setSwapTarget(null)}
          orgId={orgId}
          myShiftId={swapTarget.id}
          myUserId={user.id}
          members={members}
          onCreated={load}
        />
      )}

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Shift details</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-full text-xs font-semibold text-white"
                      style={{ background: colorForUser(detail.user_id) }}>
                  {initials(members.find((m) => m.user_id === detail.user_id)?.full_name ?? "?")}
                </span>
                <div>
                  <div className="font-medium">{members.find((m) => m.user_id === detail.user_id)?.full_name ?? "Unknown"}</div>
                  <div className="text-xs text-muted-foreground">{detail.shift_type?.label ?? "Shift"}</div>
                </div>
              </div>
              <Row k="When">{format(new Date(detail.start_at), "EEE MMM d, HH:mm")} – {format(new Date(detail.end_at), "HH:mm")}</Row>
              <Row k="Status"><Badge variant="outline" className="capitalize">{detail.status.replace("_", " ")}</Badge></Row>
              {detail.notes && <Row k="Notes">{detail.notes}</Row>}
              {detail.end_comment && <Row k="Handover">{detail.end_comment}</Row>}
            </div>
          )}
          <DialogFooter className="gap-2">
            {detail && detail.user_id === user?.id && detail.status !== "ended" && (
              <>
                <Button variant="outline" onClick={() => { setSwapTarget(detail); setDetail(null); }}>
                  Request swap
                </Button>
                <Button onClick={() => { setEndTarget(detail.id); setDetail(null); }}>End shift</Button>
              </>
            )}
            {detail && canManage && (
              <Button variant="ghost" onClick={async () => {
                if (!confirm("Delete this shift?")) return;
                const { error } = await supabase.from("shifts").delete().eq("id", detail.id);
                if (error) return toast.error(error.message);
                setDetail(null); load();
              }}>Delete</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-border py-1.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{k}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
