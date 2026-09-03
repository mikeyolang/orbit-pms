import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { HeartPulse, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { postgres } from "@/integrations/postgres/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Shift, ShiftType } from "@/lib/shifts";

interface Member { user_id: string; full_name: string | null; email: string | null }
type CoveredShift = Shift & { shift_type?: ShiftType | null; coverage_status?: string };
interface Offer { id: string; shift_id: string; user_id: string; status: string }

export function AbsenceCoveragePanel({ orgId, userId, canManage, shifts, members, onChanged }: { orgId: string; userId: string; canManage: boolean; shifts: CoveredShift[]; members: Member[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false), [type, setType] = useState("sick"), [start, setStart] = useState(""), [end, setEnd] = useState(""), [note, setNote] = useState("");
  const [saving, setSaving] = useState(false), [offers, setOffers] = useState<Offer[]>([]);
  const needed = useMemo(() => shifts.filter((s) => s.coverage_status === "needed" && new Date(s.end_at) > new Date()), [shifts]);
  const loadOffers = useCallback(async () => { const { data } = await postgres.from("shift_coverage_offers").select("id,shift_id,user_id,status").eq("organization_id", orgId).in("status", ["offered", "accepted"]); setOffers((data as Offer[]) ?? []); }, [orgId]);
  useEffect(() => { void loadOffers(); }, [loadOffers, needed.length]);
  const workload = useMemo(() => Object.fromEntries(members.map((m) => { const assigned=shifts.filter((s)=>s.user_id===m.user_id&&s.status!=="cancelled"); return [m.user_id,{hours:Math.round(assigned.reduce((n,s)=>n+Math.max(0,new Date(s.end_at).getTime()-new Date(s.start_at).getTime())/3_600_000,0)*10)/10,covered:assigned.filter((s)=>s.coverage_status==="covered").length}]; })), [members, shifts]);

  async function report(e: React.FormEvent) { e.preventDefault(); if (!start || !end) return toast.error("Choose the absence dates"); setSaving(true); const { error }=await postgres.from("shift_absences").insert({organization_id:orgId,user_id:userId,absence_type:type,starts_on:start,ends_on:end,private_note:note.trim()||null}); setSaving(false); if(error)return toast.error(error.message); toast.success("Absence reported. Affected shifts now need coverage."); setOpen(false); setNote(""); onChanged(); }
  async function volunteer(shiftId:string){const {error}=await postgres.from("shift_coverage_offers").upsert({shift_id:shiftId,organization_id:orgId,user_id:userId,status:"offered"},{onConflict:"shift_id,user_id"});if(error)return toast.error(error.message);toast.success("Coverage offer sent");await loadOffers();}
  async function approve(offerId:string){const {error}=await postgres.rpc("approve_coverage_offer",{_offer:offerId});if(error)return toast.error(error.message);toast.success("Replacement approved");await loadOffers();onChanged();}

  return <section className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><HeartPulse className="h-4 w-4 text-primary"/><h2 className="text-sm font-semibold">Absence & coverage</h2></div><p className="mt-1 text-xs text-muted-foreground">Report an absence privately or volunteer for coverage.</p></div><Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="outline">Report absence</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Report an absence</DialogTitle></DialogHeader><form onSubmit={report} className="space-y-4"><div><Label>Reason</Label><Select value={type} onValueChange={setType}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="sick">Sick</SelectItem><SelectItem value="annual_leave">Annual leave</SelectItem><SelectItem value="emergency_leave">Emergency leave</SelectItem><SelectItem value="unavailable">Unavailable</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div><div className="grid grid-cols-2 gap-3"><div><Label>From</Label><Input type="date" value={start} onChange={(e)=>{setStart(e.target.value);if(!end)setEnd(e.target.value)}} required/></div><div><Label>To</Label><Input type="date" min={start} value={end} onChange={(e)=>setEnd(e.target.value)} required/></div></div><div><Label>Private note</Label><Textarea value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Only you and managers can see this."/></div><DialogFooter><Button disabled={saving}>{saving&&<Loader2 className="h-4 w-4 animate-spin"/>} Submit</Button></DialogFooter></form></DialogContent></Dialog></div>
    {needed.length>0&&<div className="mt-4 space-y-2">{needed.map((shift)=>{const active=offers.filter((o)=>o.shift_id===shift.id&&o.status==="offered"),mine=active.some((o)=>o.user_id===userId);return <div key={shift.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><div className="text-sm font-medium">{shift.shift_type?.label??"Shift"} · {format(new Date(shift.start_at),"EEE, MMM d · HH:mm")}</div><div className="text-xs text-muted-foreground">Needs coverage</div></div><Badge variant="outline">{active.length} volunteer{active.length===1?"":"s"}</Badge>{shift.user_id!==userId&&!canManage&&<Button size="sm" disabled={mine} onClick={()=>volunteer(shift.id)}>{mine?"Offered":"Volunteer"}</Button>}</div>{canManage&&active.length>0&&<div className="mt-3 space-y-1 border-t pt-2">{active.sort((a,b)=>(workload[a.user_id]?.hours??0)-(workload[b.user_id]?.hours??0)).map((offer)=>{const m=members.find((x)=>x.user_id===offer.user_id),stats=workload[offer.user_id]??{hours:0,covered:0};return <div key={offer.id} className="flex items-center gap-2 text-sm"><span className="flex-1">{m?.full_name??m?.email??"Member"}</span><span className="text-xs text-muted-foreground">{stats.hours}h scheduled · {stats.covered} covered</span><Button size="sm" onClick={()=>approve(offer.id)}>Approve</Button></div>})}</div>}</div>})}</div>}
  </section>;
}
