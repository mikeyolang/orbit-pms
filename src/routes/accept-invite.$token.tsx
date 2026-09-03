import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { setCurrentOrgId } from "@/lib/auth";

export const Route = createFileRoute("/accept-invite/$token")({
  validateSearch: z.object({ accept: z.coerce.boolean().optional() }),
  component: AcceptInvite,
});

function AcceptInvite() {
  const { token } = Route.useParams();
  const { accept: acceptAfterVerification } = Route.useSearch();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<any>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const respond = useCallback(async (action: "accept" | "decline") => {
    setWorking(true); setError("");
    const response = await fetch(`/api/invitation/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const body = await response.json(); setWorking(false);
    if (!response.ok) return setError(body.error);
    if (action === "accept") { setCurrentOrgId(body.organizationId); navigate({ to: "/app", replace: true }); }
    else setError("Invitation declined. You can close this page.");
  }, [navigate, token]);

  useEffect(() => {
    Promise.all([fetch(`/api/invitation/${token}`).then(async (response) => ({ ok: response.ok, body: await response.json() })), authClient.getSession()]).then(([result, session]) => {
      if (!result.ok) return setError(result.body.error);
      setInvite(result.body.invite); setSignedIn(Boolean(session.data?.user));
      if (acceptAfterVerification && session.data?.user && !result.body.invite.accepted_at && !result.body.invite.declined_at && !result.body.invite.revoked_at) void respond("accept");
    });
  }, [acceptAfterVerification, respond, token]);

  function continueToAuth(mode: "signin" | "signup") {
    navigate({ to: "/auth", search: { mode, email: invite.email, invite: token } });
  }

  if (error && !invite) return <AuthShell title="Invitation unavailable" subtitle={error} />;
  if (!invite) return <AuthShell title="Loading invitation…" />;
  if (invite.accepted_at || invite.declined_at || invite.revoked_at || new Date(invite.expires_at) < new Date()) return <AuthShell title="Invitation closed" subtitle="This invitation has already been answered, revoked, or has expired." />;

  return <AuthShell title={`Join ${invite.organization_name}`} subtitle={`You have been invited as ${invite.role_name ?? invite.role}`}>
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/30 p-3 text-sm"><div className="text-xs text-muted-foreground">Invitation sent to</div><div className="font-medium">{invite.email}</div></div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {signedIn ? <><Button className="w-full" disabled={working} onClick={() => respond("accept")}>Accept and open workspace</Button><Button className="w-full" variant="outline" disabled={working} onClick={() => respond("decline")}>Decline invitation</Button></> : invite.has_account ? <Button className="w-full" onClick={() => continueToAuth("signin")}>Sign in to accept</Button> : <><Button className="w-full" onClick={() => continueToAuth("signup")}>Create account and join</Button><p className="text-center text-xs text-muted-foreground">After verifying your email, you’ll be added and taken directly to the workspace.</p></>}
    </div>
  </AuthShell>;
}
