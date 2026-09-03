import { useCallback, useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { FileText, Loader2, TrendingUp } from "lucide-react";
import { postgres } from "@/integrations/postgres/client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

interface Member { user_id: string; full_name: string | null; email: string | null }
interface Report { id: string; user_id: string; checked_out_at: string; total_tickets: number; total_value: string; unreached_clients: number; vouchers_issued: number; cancelled_tickets: number; total_chats_received: number; total_chats_handled: number; total_chats_missed: number; handover_notes: string | null }

const salesConfig = {
  tickets: { label: "Tickets", color: "#6366f1" },
  value: { label: "Ticket value", color: "#10b981" },
  cancelled: { label: "Cancelled", color: "#f59e0b" },
} satisfies ChartConfig;
const chatConfig = {
  received: { label: "Received", color: "#6366f1" },
  handled: { label: "Handled", color: "#10b981" },
  missed: { label: "Missed", color: "#ef4444" },
} satisfies ChartConfig;

export function ShiftReportsPanel({ orgId, members, canManage }: { orgId: string; members: Member[]; canManage: boolean }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [person, setPerson] = useState("all");
  const [from, setFrom] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));

  const load = useCallback(async () => {
    setReports(null);
    let query = postgres.from("shift_reports").select("*").eq("organization_id", orgId).order("checked_out_at", { ascending: false });
    if (person !== "all") query = query.eq("user_id", person);
    if (from) query = query.gte("checked_out_at", new Date(`${from}T00:00:00`).toISOString());
    if (to) query = query.lte("checked_out_at", new Date(`${to}T23:59:59.999`).toISOString());
    const { data } = await query;
    setReports((data as Report[]) ?? []);
  }, [orgId, person, from, to]);
  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => (reports ?? []).reduce((sum, report) => ({
    tickets: sum.tickets + Number(report.total_tickets), value: sum.value + Number(report.total_value),
    unreached: sum.unreached + report.unreached_clients, vouchers: sum.vouchers + report.vouchers_issued,
    cancelled: sum.cancelled + report.cancelled_tickets, received: sum.received + report.total_chats_received,
    handled: sum.handled + report.total_chats_handled, missed: sum.missed + report.total_chats_missed,
  }), { tickets: 0, value: 0, unreached: 0, vouchers: 0, cancelled: 0, received: 0, handled: 0, missed: 0 }), [reports]);

  const trends = useMemo(() => {
    const days = new Map<string, { date: string; label: string; tickets: number; value: number; cancelled: number; received: number; handled: number; missed: number }>();
    for (const report of reports ?? []) {
      const date = format(new Date(report.checked_out_at), "yyyy-MM-dd");
      const row = days.get(date) ?? { date, label: format(new Date(report.checked_out_at), "MMM d"), tickets: 0, value: 0, cancelled: 0, received: 0, handled: 0, missed: 0 };
      row.tickets += Number(report.total_tickets); row.value += Number(report.total_value); row.cancelled += report.cancelled_tickets;
      row.received += report.total_chats_received; row.handled += report.total_chats_handled; row.missed += report.total_chats_missed;
      days.set(date, row);
    }
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [reports]);

  function selectPeriod(days: number) {
    const end = new Date(); setTo(format(end, "yyyy-MM-dd")); setFrom(format(subDays(end, days - 1), "yyyy-MM-dd"));
  }

  const summaryCards = [
    { label: "Tickets", value: totals.tickets, style: "border-blue-500 bg-blue-600" },
    { label: "Value", value: totals.value.toLocaleString(undefined, { minimumFractionDigits: 2 }), style: "border-emerald-500 bg-emerald-600" },
    { label: "Cancelled", value: totals.cancelled, style: "border-amber-500 bg-amber-600" },
    { label: "Chats received", value: totals.received, style: "border-indigo-500 bg-indigo-600" },
    { label: "Chats handled", value: totals.handled, style: "border-teal-500 bg-teal-600" },
    { label: "Chats missed", value: totals.missed, style: "border-rose-500 bg-rose-600" },
    { label: "Unreached", value: totals.unreached, style: "border-orange-500 bg-orange-600" },
    { label: "Vouchers", value: totals.vouchers, style: "border-violet-500 bg-violet-600" },
  ];

  return <section className="space-y-4">
    <div className="rounded-xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-card to-card p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Shift reports</h2><p className="text-sm text-muted-foreground">Track ticket sales, cancellations, chat activity, and checkout history.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border p-1">{[[7,"7 days"],[30,"30 days"],[90,"90 days"]] .map(([days,label]) => <Button key={days} type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => selectPeriod(Number(days))}>{label}</Button>)}</div>
          {canManage && <Select value={person} onValueChange={setPerson}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All members</SelectItem>{members.map((member) => <SelectItem key={member.user_id} value={member.user_id}>{member.full_name ?? member.email}</SelectItem>)}</SelectContent></Select>}
          <Input className="w-36" type="date" aria-label="Reports from date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <Input className="w-36" type="date" aria-label="Reports to date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">{summaryCards.map((card) => <div key={card.label} className={`rounded-xl border p-3 text-white shadow-sm transition-transform hover:-translate-y-0.5 ${card.style}`}><div className="text-xs font-semibold text-white">{card.label}</div><div className="mt-1 text-lg font-bold text-white">{card.value}</div></div>)}</div>
    </div>

    {reports === null ? <div className="grid min-h-72 place-items-center rounded-xl border bg-card"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : <>
      <div className="grid gap-4 xl:grid-cols-2">
        <TrendCard tone="blue" title="Ticket activity trend" description="Tickets sold and cancelled each day">
          <ChartContainer config={salesConfig} className="h-[280px] w-full">
            <LineChart data={trends} margin={{ left: 4, right: 16, top: 12 }}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} /><YAxis tickLine={false} axisLine={false} width={38} /><ChartTooltip content={<ChartTooltipContent />} /><Line type="monotone" dataKey="tickets" stroke="var(--color-tickets)" strokeWidth={2.5} dot={false} /><Line type="monotone" dataKey="cancelled" stroke="var(--color-cancelled)" strokeWidth={2.5} dot={false} /></LineChart>
          </ChartContainer>
        </TrendCard>
        <TrendCard tone="emerald" title="Chat handling trend" description="Received, handled, and missed chats each day">
          <ChartContainer config={chatConfig} className="h-[280px] w-full">
            <LineChart data={trends} margin={{ left: 4, right: 16, top: 12 }}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} /><YAxis tickLine={false} axisLine={false} width={38} /><ChartTooltip content={<ChartTooltipContent />} /><Line type="monotone" dataKey="received" stroke="var(--color-received)" strokeWidth={2.5} dot={false} /><Line type="monotone" dataKey="handled" stroke="var(--color-handled)" strokeWidth={2.5} dot={false} /><Line type="monotone" dataKey="missed" stroke="var(--color-missed)" strokeWidth={2.5} dot={false} /></LineChart>
          </ChartContainer>
        </TrendCard>
      </div>

      <div className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 via-card to-card p-4 shadow-sm"><h3 className="font-semibold">Report history</h3><p className="text-xs text-muted-foreground">Open any report to view its company-by-company PDF.</p><div className="mt-3 divide-y rounded-lg border bg-background/60">{reports.map((report) => { const member = members.find((item) => item.user_id === report.user_id); return <div key={report.id} className="flex items-center gap-3 p-3 transition-colors hover:bg-violet-500/5"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-300"><FileText className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="text-sm font-medium">{member?.full_name ?? member?.email ?? "Member"} · {format(new Date(report.checked_out_at), "MMM d, yyyy HH:mm")}</div><div className="text-xs text-muted-foreground">{report.total_tickets} tickets · {Number(report.total_value).toLocaleString(undefined, { minimumFractionDigits: 2 })} · {report.total_chats_received} chats received · {report.total_chats_handled} handled · {report.total_chats_missed} missed{report.handover_notes ? ` · Handover: ${report.handover_notes}` : ""}</div></div><Button asChild size="sm" variant="outline"><a href={`/api/shift-report/${report.id}/pdf`} target="_blank" rel="noreferrer">PDF</a></Button></div>; })}{reports.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No reports for this period.</p>}</div></div>
    </>}
  </section>;
}

function TrendCard({ title, description, children, tone }: { title: string; description: string; children: React.ReactNode; tone: "blue" | "emerald" }) {
  const style = tone === "blue" ? "border-blue-500/20 from-blue-500/10" : "border-emerald-500/20 from-emerald-500/10";
  const icon = tone === "blue" ? "bg-blue-500/15 text-blue-600 dark:text-blue-300" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
  return <div className={`rounded-xl border bg-gradient-to-br via-card to-card p-4 shadow-sm ${style}`}><div className="flex items-start gap-2"><div className={`rounded-lg p-2 ${icon}`}><TrendingUp className="h-4 w-4" /></div><div><h3 className="text-sm font-semibold">{title}</h3><p className="text-xs text-muted-foreground">{description}</p></div></div><div className="mt-3">{children}</div></div>;
}
