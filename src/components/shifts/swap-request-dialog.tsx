import { useState } from "react";
import { postgres } from "@/integrations/postgres/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { SwapKind } from "@/lib/shifts";

interface Member { user_id: string; full_name: string | null; email: string | null }

export function SwapRequestDialog({
  open, onOpenChange, orgId, myShiftId, myUserId, members, defaultKind, defaultToUser, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string;
  myShiftId: string;
  myUserId: string;
  members: Member[];
  defaultKind?: SwapKind;
  defaultToUser?: string;
  onCreated?: () => void;
}) {
  const [kind, setKind] = useState<SwapKind>(defaultKind ?? "direct");
  const [toUser, setToUser] = useState(defaultToUser ?? "");
  const [reason, setReason] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredStart, setPreferredStart] = useState("");
  const [preferredEnd, setPreferredEnd] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if ((preferredDate || preferredStart || preferredEnd) && !(preferredDate && preferredStart && preferredEnd)) return toast.error("Complete the preferred date, start, and end time");
    const preferredStartAt = preferredDate ? new Date(`${preferredDate}T${preferredStart}`).toISOString() : null;
    let preferredEndAt = preferredDate ? new Date(`${preferredDate}T${preferredEnd}`).toISOString() : null;
    if (preferredStartAt && preferredEndAt && new Date(preferredEndAt) <= new Date(preferredStartAt)) preferredEndAt = new Date(new Date(preferredEndAt).getTime() + 86_400_000).toISOString();
    setLoading(true);
    const { error } = await postgres.from("shift_swap_requests").insert({
      organization_id: orgId,
      from_shift_id: myShiftId,
      from_user_id: myUserId,
      to_user_id: kind === "direct" ? toUser || null : null,
      kind,
      reason: reason || null,
      preferred_start_at: preferredStartAt,
      preferred_end_at: preferredEndAt,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success(kind === "open" ? "Posted to swap board" : "Swap request sent");
    onOpenChange(false);
    onCreated?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Request swap or coverage</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as SwapKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direct swap (pick a teammate)</SelectItem>
                <SelectItem value="open">Up for grabs (anyone can claim)</SelectItem>
                <SelectItem value="coverage">Coverage (ask a manager)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "direct" && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Teammate</Label>
              <Select value={toUser} onValueChange={setToUser}>
                <SelectTrigger><SelectValue placeholder="Choose teammate" /></SelectTrigger>
                <SelectContent>
                  {members.filter((m) => m.user_id !== myUserId).map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>{m.full_name ?? m.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2 rounded-lg border border-border/60 p-3">
            <div><Label className="text-xs text-muted-foreground">Preferred change (optional)</Label><p className="text-[11px] text-muted-foreground">Show the date and time you would prefer instead.</p></div>
            <div className="grid grid-cols-3 gap-2"><Input type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} /><Input type="time" value={preferredStart} onChange={(e) => setPreferredStart(e.target.value)} /><Input type="time" value={preferredEnd} onChange={(e) => setPreferredEnd(e.target.value)} /></div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Reason (optional)</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Doctor's appointment, family event…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
