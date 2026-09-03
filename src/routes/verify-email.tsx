import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const search = z.object({
  email: z.string().email(),
  invite: z.string().optional(),
});

export const Route = createFileRoute("/verify-email")({
  validateSearch: search,
  component: VerifyEmail,
});

function VerifyEmail() {
  const { email, invite } = Route.useSearch();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(60);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Email verified");
    if (invite) {
      navigate({ to: "/accept-invite/$token", params: { token: invite } });
    } else {
      navigate({ to: "/onboarding" });
    }
  }

  async function resend() {
    setLoading(true);
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("New code sent");
    setResendIn(60);
  }

  return (
    <AuthShell
      title="Check your email"
      subtitle={`We sent a 6-digit code to ${email}`}
      footer={
        <Link to="/auth" className="hover:text-foreground">
          Use a different email
        </Link>
      }
    >
      <form onSubmit={verify} className="space-y-6">
        <div className="flex justify-center">
          <InputOTP maxLength={6} value={code} onChange={setCode}>
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Verify email
        </Button>
        <div className="text-center text-xs text-muted-foreground">
          Code expires in 10 minutes.{" "}
          {resendIn > 0 ? (
            <span>Resend in {resendIn}s</span>
          ) : (
            <button type="button" onClick={resend} className="text-foreground underline underline-offset-4">
              Resend code
            </button>
          )}
        </div>
      </form>
    </AuthShell>
  );
}
