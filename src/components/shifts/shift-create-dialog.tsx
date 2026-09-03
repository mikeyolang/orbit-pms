import { useEffect, useState } from "react";
import { postgres } from "@/integrations/postgres/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { dayShiftAtRange, ymd, type ShiftType } from "@/lib/shifts";

interface Member { user_id: string; full_name: string | null; email: string | null }

export function ShiftCreateDialog({
  open, onOpenChange, orgId, members, shiftTypes, defaults, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string;
  members: Member[];
  shiftTypes: ShiftType[];
  defaults?: { userId?: string; date?: Date; shiftTypeId?: string };
  onCreated?: () => void;
}) {
  const [userId, setUserId] = useState<string>("");
  const [typeId, setTypeId] = useState<string>("");
  const [start, setStart] = useState<string>(ymd(new Date()));
  const [end, setEnd] = useState<string>(ymd(new Date()));
  const [notes, setNotes] = useState("");
  const [repeatMonthly, setRepeatMonthly] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUserId(defaults?.userId ?? members[0]?.user_id ?? "");
    setTypeId(defaults?.shiftTypeId ?? shiftTypes[0]?.id ?? "");
    const d = defaults?.date ? ymd(defaults.date) : ymd(new Date());
    setStart(d);
    setEnd(d);
    setNotes("");
    setRepeatMonthly(false);
  }, [open, defaults, members, shiftTypes]);

  const type = shiftTypes.find((t) => t.id === typeId);

  async function submit() {
    if (!userId || !typeId || !type) return toast.error("Choose member and shift type");
    setLoading(true);
    const { data: u } = await postgres.auth.getUser();
    const startDate = new Date(start + "T00:00:00");
    const endDate = new Date(end + "T00:00:00");
    const rows: {
      organization_id: string; user_id: string; shift_type_id: string;
      start_at: string; end_at: string; notes: string | null; created_by: string | null;
    }[] = [];

    const monthsToRepeat = repeatMonthly ? 3 : 1; // this + next 2
    for (let m = 0; m < monthsToRepeat; m++) {
      const cur = new Date(startDate); cur.setMonth(cur.getMonth() + m);
      const stop = new Date(endDate); stop.setMonth(stop.getMonth() + m);
      for (let d = new Date(cur); d <= stop; d.setDate(d.getDate() + 1)) {
        const { start_at, end_at } = dayShiftAtRange(d, type.start_time, type.end_time);
        rows.push({
          organization_id: orgId,
          user_id: userId,
          shift_type_id: typeId,
          start_at, end_at,
          notes: notes || null,
          created_by: u.user?.id ?? null,
        });
      }
    }

    const { error } = await postgres.from("shifts").insert(rows);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success(`${rows.length} shift${rows.length > 1 ? "s" : ""} scheduled`);
    onOpenChange(false);
    onCreated?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Schedule shift</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Member">
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.full_name ?? m.email ?? "Unknown"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Shift type">
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {shiftTypes.filter((t) => t.is_active).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                      {t.label} · {t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="End date"><Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
          <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={repeatMonthly} onCheckedChange={(v) => setRepeatMonthly(!!v)} />
            Repeat for the next 2 months
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
