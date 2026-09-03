import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const search = z.object({ email: z.string().email() });

export const Route = createFileRoute("/reset-password")({
  validateSearch: search,
  component: ResetPassword,
});

function ResetPassword() {
  const { email } = Route.useSearch();
  const navigate = useNavigate();
  const [step, setStep] = useState<"verify" | "newpass">("verify");
  const [code, setCode] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "recovery" });
    setLoading(false);
    if (error) {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= 3) {
        toast.error("Too many incorrect attempts. Restart the reset process.");
        navigate({ to: "/forgot-password" });
        return;
      }
      toast.error(`${error.message} (${3 - next} attempts left)`);
      return;
    }
    setStep("newpass");
  }

  async function setNewPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (password !== confirm) return toast.error("Passwords don't match");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.auth.signOut();
    toast.success("Password updated. Please sign in.");
    navigate({ to: "/auth", search: { mode: "signin", email } });
  }

  async function resend() {
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("New code sent");
    setResendIn(60);
  }

  if (step === "verify") {
    return (
      <AuthShell
        title="Verify your identity"
        subtitle={`Enter the 6-digit code sent to ${email}`}
        footer={
          <Link to="/forgot-password" className="hover:text-foreground">
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
            Verify code
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

  return (
    <AuthShell title="Set a new password" subtitle="Choose something strong">
      <form onSubmit={setNewPassword} className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">New password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
          <PasswordStrength value={password} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Confirm password</Label>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required autoComplete="new-password" />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}

function PasswordStrength({ value }: { value: string }) {
  const score = scorePassword(value);
  const labels = ["Too weak", "Weak", "Okay", "Strong", "Excellent"];
  const colors = ["bg-destructive", "bg-destructive", "bg-warning", "bg-success", "bg-success"];
  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full ${i < score ? colors[score] : "bg-muted"}`} />
        ))}
      </div>
      {value && <p className="mt-1 text-xs text-muted-foreground">{labels[score]}</p>}
    </div>
  );
}
function scorePassword(p: string) {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 4);
}
