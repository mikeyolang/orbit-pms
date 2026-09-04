import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.string().email().safeParse(email.trim());
    if (!parsed.success) {
      toast.error("Enter a valid email");
      return;
    }
    setLoading(true);
    const { error } = await authClient.requestPasswordReset({
      email: parsed.data,
      redirectTo: "/reset-password",
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSentTo(parsed.data);
    toast.success("If an account exists, a reset link is on its way");
  }

  if (sentTo) {
    return (
      <AuthShell title="Check your email" subtitle="Your password reset link is on its way">
        <div className="text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"><CheckCircle2 className="h-7 w-7" /></div>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">If an account exists for <strong className="text-foreground">{sentTo}</strong>, it will receive a secure link for choosing a new password.</p>
          <p className="mt-3 text-xs text-muted-foreground">For local testing, open Mailpit and check the inbox. Also check your spam folder when using a live mail provider.</p>
          <Button variant="outline" className="mt-6 w-full" onClick={() => setSentTo(null)}>Send another link</Button>
          <Link to="/auth" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-300"><ArrowLeft className="h-4 w-4" />Back to sign in</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Forgot password?"
      subtitle="Enter your email and we'll send you a secure reset link"
      footer={
        <Link to="/auth" className="hover:text-foreground">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Email</Label>
          <Input
            className="h-11 bg-white dark:bg-slate-950"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <Button type="submit" className="w-full bg-[#1B3673] text-white hover:bg-[#142A5C]" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          <Mail className="h-4 w-4" /> Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}
