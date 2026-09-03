import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/shift-request/$token")({ component: ShiftRequest });
function ShiftRequest() {
  const { token } = Route.useParams(); const [item, setItem] = useState<any>(null); const [message, setMessage] = useState(""); const [working, setWorking] = useState(false);
  useEffect(() => { fetch(`/api/shift-request/${token}`).then(async (r) => { const body = await r.json(); r.ok ? setItem(body.request) : setMessage(body.error); }); }, [token]);
  async function respond(action: "accept" | "decline") {
    setWorking(true); const response = await fetch(`/api/shift-request/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const body = await response.json(); setWorking(false); setMessage(response.ok ? `Request ${action === "accept" ? "accepted" : "declined"}.` : body.error);
    if (response.ok) setItem((old: any) => ({ ...old, status: action === "accept" ? "applied" : "declined" }));
  }
  if (!item) return <AuthShell title="Shift request" subtitle={message || "Loading…"} />;
  const active = ["pending", "approved"].includes(item.status);
  return <AuthShell title="Shift request" subtitle={`${item.requester_name ?? "A teammate"} requests ${item.kind} coverage`}><div className="space-y-4 text-sm"><div className="rounded-lg border p-3"><div className="text-xs uppercase text-muted-foreground">Current shift</div><div className="font-medium">{item.shift_type ?? "Shift"}</div><div className="text-muted-foreground">{new Date(item.start_at).toLocaleString()} – {new Date(item.end_at).toLocaleString()}</div>{item.reason && <p className="mt-2">“{item.reason}”</p>}</div>{item.preferred_start_at && <div className="rounded-lg border border-primary/30 bg-primary/5 p-3"><div className="text-xs uppercase text-muted-foreground">Requested change</div><div className="font-medium">{new Date(item.preferred_start_at).toLocaleString()} – {new Date(item.preferred_end_at).toLocaleString()}</div></div>}{message && <p>{message}</p>}{active && item.kind !== "coverage" && <div className="flex gap-2"><Button className="flex-1" disabled={working} onClick={() => respond("accept")}>Accept and take shift</Button>{item.kind !== "open" && <Button className="flex-1" variant="outline" disabled={working} onClick={() => respond("decline")}>Decline</Button>}</div>}{active && item.kind === "coverage" && <Button asChild className="w-full"><Link to="/app/shifts">Choose a replacement in Shifts</Link></Button>}<p className="text-center text-xs text-muted-foreground">Sign in with your verified account before responding. <Link to="/auth" search={{ mode: "signin" }} className="underline">Sign in</Link></p></div></AuthShell>;
}
