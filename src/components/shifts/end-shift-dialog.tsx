import { useState } from "react";
import { postgres } from "@/integrations/postgres/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export function EndShiftDialog({
  open, onOpenChange, shiftId, onEnded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  shiftId: string;
  onEnded?: () => void;
}) {
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    const { error } = await postgres
      .from("shifts")
      .update({ status: "ended", ended_at: new Date().toISOString(), end_comment: comment || null })
      .eq("id", shiftId);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Shift ended");
    setComment("");
    onOpenChange(false);
    onEnded?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>End shift</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Handover comment (optional)</Label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Anything the next person on shift should know?"
            rows={4}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}End shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
