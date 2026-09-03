import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { setCurrentOrgId } from "@/lib/auth";

export const Route = createFileRoute("/accept-invite/$token")({
  component: AcceptInvite,
});

interface Invite {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  organization: { name: string };
}

function AcceptInvite() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "invalid" | "expired" | "accepted">("loading");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("invitations")
        .select("id, organization_id, email, role, expires_at, accepted_at, organization:organizations(name)")
        .eq("token", token)
        .maybeSingle();
      if (!data) return setStatus("invalid");
      const inv = data as unknown as Invite;
      setInvite(inv);
      if (inv.accepted_at) setStatus("accepted");
      else if (new Date(inv.expires_at) < new Date()) setStatus("expired");
      else setStatus("ready");
    })();
  }, [token]);

  async function accept() {
    if (!invite) return;
    setWorking(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      // Send to signup with email prefilled + invite token
      navigate({ to: "/auth", search: { mode: "signup", email: invite.email, invite: token } });
      return;
    }
    if (u.user.email?.toLowerCase() !== invite.email.toLowerCase()) {
      setWorking(false);
      toast.error(`This invite is for ${invite.email}. Sign in with that email to accept.`);
      return;
    }
    const { error: memErr } = await supabase
      .from("organization_members")
      .insert({ organization_id: invite.organization_id, user_id: u.user.id, role: invite.role as never });
    if (memErr && !memErr.message.includes("duplicate")) {
      setWorking(false);
      return toast.error(memErr.message);
    }
    await supabase.from("invitations").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);
    setCurrentOrgId(invite.organization_id);
    toast.success(`Welcome to ${invite.organization.name}`);
    navigate({ to: "/app" });
  }

  if (status === "loading") {
    return (
      <AuthShell title="Loading invite…">
        <div className="flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      </AuthShell>
    );
  }
  if (status === "invalid") return <AuthShell title="Invalid invitation" subtitle="This link is not valid." />;
  if (status === "expired") return <AuthShell title="Invitation expired" subtitle="Ask an admin to send a new one." />;
  if (status === "accepted") return <AuthShell title="Already accepted" subtitle="You've already joined this workspace." />;

  return (
    <AuthShell
      title={`Join ${invite!.organization.name}`}
      subtitle={`Invited as ${invite!.role} • ${invite!.email}`}
    >
      <Button className="w-full" onClick={accept} disabled={working}>
        {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Accept invitation
      </Button>
    </AuthShell>
  );
}
