import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";

const search = z.object({ email: z.string().email(), invite: z.string().optional() });

export const Route = createFileRoute("/verify-email")({
  validateSearch: search,
  component: VerifyEmail,
});

function VerifyEmail() {
  const { email, invite } = Route.useSearch();
  const [loading, setLoading] = useState(false);

  async function resend() {
    setLoading(true);
    const callbackURL = invite ? `/accept-invite/${invite}?accept=1` : "/app";
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Verification link sent");
  }

  return (
    <AuthShell
      title="Check your email"
      subtitle={`We sent a verification link to ${email}`}
      footer={
        <Link to="/auth" className="hover:text-foreground">
          Use a different email
        </Link>
      }
    >
      <div className="space-y-5 text-center">
        <MailCheck className="mx-auto h-10 w-10 text-primary" />
        <p className="text-sm text-muted-foreground">
          Open the link in the message to verify your address. The link will return you securely to
          Orbit.
        </p>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={loading}
          onClick={resend}
        >
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Resend verification link
        </Button>
      </div>
    </AuthShell>
  );
}
