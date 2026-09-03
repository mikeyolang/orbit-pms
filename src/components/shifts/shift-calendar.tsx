import { useMemo, useState } from "react";
import {
  DndContext, DragOverlay, useDraggable, useDroppable, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { postgres } from "@/integrations/postgres/client";
import { toast } from "sonner";
import { addDays, addMonths, endOfMonth, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Plus, GripVertical } from "lucide-react";
import { colorForUser, dayShiftAtRange, initials, ymd, type Shift, type ShiftType } from "@/lib/shifts";

interface Member { user_id: string; full_name: string | null; email: string | null }

type ShiftWithMeta = Shift & { shift_type?: ShiftType | null };

export function ShiftCalendar({
  cursor, onCursor, shifts, shiftTypes, members, canManage, currentUserId,
  onCreateAt, onShiftClick, onReload,
}: {
  cursor: Date;
  onCursor: (d: Date) => void;
  shifts: ShiftWithMeta[];
  shiftTypes: ShiftType[];
  members: Member[];
  canManage: boolean;
  currentUserId: string;
  onCreateAt: (day: Date, userId?: string, shiftTypeId?: string) => void;
  onShiftClick: (s: ShiftWithMeta) => void;
  onReload: () => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [activeDrag, setActiveDrag] = useState<{ kind: "member" | "shift"; id: string; label: string; color: string } | null>(null);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfMonth(cursor);
    const arr: Date[] = [];
    let d = start;
    while (d <= end || arr.length % 7 !== 0) {
      arr.push(d);
      d = addDays(d, 1);
    }
    return arr;
  }, [cursor]);

  const byDay = useMemo(() => {
    const map: Record<string, ShiftWithMeta[]> = {};
    for (const s of shifts) {
      const k = ymd(new Date(s.start_at));
      (map[k] ??= []).push(s);
    }
    return map;
  }, [shifts]);

  async function moveShift(shiftId: string, toDay: Date, toUserId?: string) {
    const s = shifts.find((x) => x.id === shiftId);
    if (!s) return;
    const type = shiftTypes.find((t) => t.id === s.shift_type_id) ?? s.shift_type;
    if (!type) return toast.error("Shift type missing");
    const { start_at, end_at } = dayShiftAtRange(toDay, type.start_time, type.end_time);
    const patch: Partial<Shift> = { start_at, end_at };
    if (toUserId && toUserId !== s.user_id) {
      if (!canManage && s.user_id === currentUserId) {
        toast.info("Request a swap instead", { description: "Support members can't reassign shifts directly." });
        return;
      }
      patch.user_id = toUserId;
    }
    const { error } = await postgres.from("shifts").update(patch).eq("id", shiftId);
    if (error) return toast.error(error.message);
    toast.success("Shift updated");
    onReload();
  }

  async function assignMember(userId: string, day: Date, typeId?: string) {
    const t = shiftTypes.find((x) => x.id === typeId) ?? shiftTypes.find((x) => x.is_active) ?? shiftTypes[0];
    if (!t) return toast.error("No shift types configured");
    onCreateAt(day, userId, t.id);
  }

  function onDragStart(e: DragStartEvent) {
    const d = e.active.data.current as { kind: string; label: string; color: string } | undefined;
    if (d) setActiveDrag({ kind: d.kind as "member" | "shift", id: String(e.active.id), label: d.label, color: d.color });
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveDrag(null);
    if (!e.over) return;
    const overId = String(e.over.id);
    const activeData = e.active.data.current as { kind: string } | undefined;
    if (!activeData) return;
    // Drop targets look like "day:YYYY-MM-DD"
    if (!overId.startsWith("day:")) return;
    const day = new Date(overId.slice(4) + "T00:00:00");
    if (activeData.kind === "member") {
      if (!canManage) return toast.error("Only managers can schedule members");
      assignMember(String(e.active.id).replace("member:", ""), day);
    } else if (activeData.kind === "shift") {
      moveShift(String(e.active.id).replace("shift:", ""), day);
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex gap-4">
        <div className="flex-1 rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border p-3">
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={() => onCursor(addMonths(cursor, -1))}><ChevronLeft className="h-4 w-4" /></Button>
              <div className="min-w-[160px] text-center text-sm font-medium">{format(cursor, "MMMM yyyy")}</div>
              <Button size="icon" variant="ghost" onClick={() => onCursor(addMonths(cursor, 1))}><ChevronRight className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" className="ml-2" onClick={() => onCursor(new Date())}>Today</Button>
            </div>
          </div>
          <div className="grid grid-cols-7 border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="px-2 py-1.5 text-center">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => (
              <DayCell
                key={ymd(day)}
                day={day}
                inMonth={isSameMonth(day, cursor)}
                shifts={byDay[ymd(day)] ?? []}
                onCreate={() => canManage && onCreateAt(day)}
                onShiftClick={onShiftClick}
                canManage={canManage}
                currentUserId={currentUserId}
              />
            ))}
          </div>
        </div>

        {canManage && (
          <aside className="hidden w-56 shrink-0 rounded-xl border border-border bg-card p-3 lg:block">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Drag members onto a day</div>
            <div className="space-y-1.5">
              {members.map((m) => (
                <MemberChip key={m.user_id} member={m} />
              ))}
            </div>
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Legend</div>
              <div className="space-y-1">
                {shiftTypes.filter((t) => t.is_active).map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                    <span className="text-muted-foreground">{t.label} · {t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>

      <DragOverlay>
        {activeDrag && (
          <div className="rounded-md px-2 py-1 text-xs font-medium text-white shadow-lg" style={{ background: activeDrag.color }}>
            {activeDrag.label}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function DayCell({
  day, inMonth, shifts, onCreate, onShiftClick, canManage, currentUserId,
}: {
  day: Date;
  inMonth: boolean;
  shifts: ShiftWithMeta[];
  onCreate: () => void;
  onShiftClick: (s: ShiftWithMeta) => void;
  canManage: boolean;
  currentUserId: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${ymd(day)}` });
  const isToday = isSameDay(day, new Date());
  return (
    <div
      ref={setNodeRef}
      className={`group relative min-h-[110px] border-b border-r border-border p-1.5 transition-colors ${
        inMonth ? "" : "bg-muted/30 opacity-60"
      } ${isOver ? "bg-primary/10 ring-1 ring-inset ring-primary" : ""}`}
    >
      <div className="mb-1 flex items-center justify-between">
        <div className={`text-xs ${isToday ? "grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground font-semibold" : "text-muted-foreground"}`}>
          {day.getDate()}
        </div>
        {canManage && (
          <button onClick={onCreate} className="opacity-0 transition-opacity group-hover:opacity-100">
            <Plus className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>
      <div className="space-y-1">
        {shifts.slice(0, 4).map((s) => (
          <ShiftChip key={s.id} shift={s} onClick={() => onShiftClick(s)} draggable={canManage || s.user_id === currentUserId} />
        ))}
        {shifts.length > 4 && (
          <div className="text-[10px] text-muted-foreground">+{shifts.length - 4} more</div>
        )}
      </div>
    </div>
  );
}

function ShiftChip({ shift, onClick, draggable }: { shift: ShiftWithMeta; onClick: () => void; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `shift:${shift.id}`,
    disabled: !draggable,
    data: { kind: "shift", label: shift.shift_type?.label ?? "Shift", color: shift.shift_type?.color ?? "#6366f1" },
  });
  const color = shift.shift_type?.color ?? "#6366f1";
  const ended = shift.status === "ended";
  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-opacity ${isDragging ? "opacity-30" : ""}`}
      style={{ background: color + "22", color, borderLeft: `3px solid ${color}` }}
    >
      {draggable && (
        <span {...listeners} {...attributes} className="cursor-grab opacity-60 hover:opacity-100" onClick={(e) => e.stopPropagation()}>
          <GripVertical className="h-3 w-3" />
        </span>
      )}
      <span
        className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white"
        style={{ background: colorForUser(shift.user_id) }}
      >
        {initials(shift.user_id.slice(0, 2))}
      </span>
      <span className={`min-w-0 flex-1 truncate ${ended ? "line-through opacity-60" : ""}`}>
        {shift.shift_type?.label ?? "Shift"}
      </span>
    </div>
  );
}

function MemberChip({ member }: { member: Member }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `member:${member.user_id}`,
    data: { kind: "member", label: member.full_name ?? member.email ?? "?", color: colorForUser(member.user_id) },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex cursor-grab items-center gap-2 rounded-md border border-border bg-background p-1.5 text-xs active:cursor-grabbing ${isDragging ? "opacity-30" : ""}`}
    >
      <span className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-white"
            style={{ background: colorForUser(member.user_id) }}>
        {initials(member.full_name ?? member.email)}
      </span>
      <span className="truncate">{member.full_name ?? member.email}</span>
    </div>
  );
}
