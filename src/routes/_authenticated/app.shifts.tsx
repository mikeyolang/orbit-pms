import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { postgres } from "@/integrations/postgres/client";
import { useAuthSession } from "@/lib/auth";
import { useMyPermissions } from "@/lib/permissions";
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
  const { can } = useMyPermissions(orgId);

  const [cursor, setCursor] = useState(new Date());
  const [shifts, setShifts] = useState<ShiftFull[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [swaps, setSwaps] = useState<(SwapRequest & { from_shift?: ShiftFull | null; from_profile?: { full_name: string | null; email: string | null } | null })[]>([]);
  const [settings, setSettings] = useState<ShiftSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [handover, setHandover] = useState<{handover_notes:string;checked_out_at:string;member_name:string}|null>(null);

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
      postgres.from("shift_types").select("*").eq("organization_id", orgId).order("sort_order"),
      postgres.from("shifts").select("*, shift_type:shift_types(*)").eq("organization_id", orgId)
        .gte("start_at", monthStart).lte("start_at", monthEnd).order("start_at"),
      postgres.from("organization_members").select("user_id").eq("organization_id", orgId),
      postgres.from("shift_swap_requests").select("*, from_shift:shifts!from_shift_id(*, shift_type:shift_types(*))")
        .eq("organization_id", orgId).in("status", ["pending", "approved"]),
      postgres.from("shift_settings").select("*").eq("organization_id", orgId).maybeSingle(),
    ]);
    setSettings((cfg.data as ShiftSettings) ?? null);
    setShiftTypes((t.data as ShiftType[]) ?? []);
    setShifts((s.data as ShiftFull[]) ?? []);
    const memberIds = Array.from(
      new Set(((m.data as { user_id: string }[]) ?? []).map((x) => x.user_id)),
    );
    let profileMap: Record<string, { full_name: string | null; email: string | null }> = {};
    if (memberIds.length) {
      const { data: profs } = await postgres
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
  useEffect(()=>{if(currentOrg.can_access_shifts!==false)postgres.rpc("latest_shift_handover",{_org:orgId}).then(({data})=>setHandover(data?.[0]??null))},[orgId,currentOrg.can_access_shifts]);

  function openCreate(day?: Date, userId?: string, shiftTypeId?: string) {
    setCreateDefaults({ date: day, userId, shiftTypeId });
    setCreateOpen(true);
  }

  async function copyPreviousMonth() {
    const prevStart = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    const prevEnd = new Date(cursor.getFullYear(), cursor.getMonth(), 0, 23, 59, 59);
    const { data: prev } = await postgres.from("shifts")
      .select("*, shift_type:shift_types(*)")
      .eq("organization_id", orgId)
      .gte("start_at", prevStart.toISOString())
      .lte("start_at", prevEnd.toISOString());
    if (!prev || prev.length === 0) return toast.info("Nothing to copy from the previous month");
    const { data: u } = await postgres.auth.getUser();
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
    const { error } = await postgres.from("shifts").insert(rows);
    if (error) return toast.error(error.message);
    toast.success(`Copied ${rows.length} shifts to ${format(cursor, "MMMM yyyy")}`);
    load();
  }

  async function copyRecentPattern(weeks: 1 | 2) {
    const end = new Date(); end.setHours(23,59,59,999);
    const start = new Date(end); start.setDate(start.getDate() - weeks * 7 + 1); start.setHours(0,0,0,0);
    const { data } = await postgres.from("shifts").select("*").eq("organization_id",orgId).gte("start_at",start.toISOString()).lte("start_at",end.toISOString());
    if (!data?.length) return toast.info(`No shifts found in the last ${weeks} week${weeks>1?"s":""}`);
    const { data:u }=await postgres.auth.getUser(); const offset=weeks*7*86_400_000;
    const rows=(data as ShiftFull[]).map(s=>({organization_id:orgId,user_id:s.user_id,shift_type_id:s.shift_type_id,start_at:new Date(new Date(s.start_at).getTime()+offset).toISOString(),end_at:new Date(new Date(s.end_at).getTime()+offset).toISOString(),notes:s.notes,created_by:u.user?.id??null}));
    const {error}=await postgres.from("shifts").insert(rows);if(error)return toast.error(error.message);toast.success(`Copied ${weeks}-week pattern forward`);load();
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

  async function checkIn(shift: ShiftFull) {
    const { error } = await postgres.from("shifts").update({ status: "in_progress", started_at: new Date().toISOString() }).eq("id", shift.id);
    if (error) return toast.error(error.message);
    toast.success("Checked in successfully"); load();
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shifts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Rota, coverage, and swap requests for {currentOrg.organization.name}.</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && <Button size="sm" variant="outline" onClick={()=>copyRecentPattern(1)}>Copy 1-week pattern</Button>}
          {canManage && <Button size="sm" variant="outline" onClick={()=>copyRecentPattern(2)}>Copy 2-week pattern</Button>}
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
            {activeNow.started_at ? <Button size="sm" onClick={() => setEndTarget(activeNow.id)}><StopCircle className="h-4 w-4" /> Check out</Button> : <Button size="sm" onClick={() => checkIn(activeNow)}><Play className="h-4 w-4" /> Check in</Button>}
          </div>
        </div>
      )}
      {activeNow && handover && <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"><div className="text-xs font-medium uppercase tracking-wide text-amber-600">Handover from {handover.member_name}</div><p className="mt-1 text-sm">{handover.handover_notes}</p><div className="mt-1 text-xs text-muted-foreground">Submitted {format(new Date(handover.checked_out_at),"MMM d, HH:mm")}</div></div>}

      <SwapBoard requests={swaps} currentUserId={user?.id ?? ""} isManager={canManage} members={members} onChange={load} />

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
        <EndShiftDialog open={!!endTarget} onOpenChange={(v) => !v && setEndTarget(null)} shiftId={endTarget} orgId={orgId} onEnded={load} />
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
            {detail && can("shifts.delete") && (
              <Button variant="ghost" onClick={async () => {
                if (!confirm("Delete this shift?")) return;
                const { error } = await postgres.from("shifts").delete().eq("id", detail.id);
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
