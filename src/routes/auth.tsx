import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const searchSchema = z.object({
  mode: z.enum(["signin", "signup"]).optional(),
  invite: z.string().optional(),
  email: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  component: AuthPage,
});

function AuthPage() {
  const { mode: initialMode, invite, email: prefillEmail } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">(initialMode ?? "signin");
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(prefillEmail ?? "");
  const [password, setPassword] = useState("");

  // Already signed in? Keep the session and go straight into the app.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session && !invite) navigate({ to: "/onboarding", replace: true });
    });
    return () => {
      active = false;
    };
  }, [invite, navigate]);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.object({
      fullName: z.string().trim().min(1, "Name is required").max(80),
      email: z.string().trim().email("Invalid email").max(255),
      password: z.string().min(8, "Password must be at least 8 characters").max(72),
    }).safeParse({ fullName, email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { data: signUpData, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { full_name: parsed.data.fullName },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) {
      setLoading(false);
      toast.error(error.message);
      return;
    }
    // Auto-confirm is enabled — ensure we have a session, then continue.
    if (!signUpData.session) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (signInError) {
        setLoading(false);
        toast.error(signInError.message);
        return;
      }
    }
    setLoading(false);
    toast.success("Account created");
    if (invite) {
      navigate({ to: "/accept-invite/$token", params: { token: invite } });
    } else {
      navigate({ to: "/onboarding" });
    }
  }

  async function handleSignin(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.object({
      email: z.string().trim().email("Invalid email"),
      password: z.string().min(1, "Password is required"),
    }).safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Signed in");
    if (invite) {
      navigate({ to: "/accept-invite/$token", params: { token: invite } });
    } else {
      navigate({ to: "/onboarding" });
    }
  }

  if (mode === "signup") {
    return (
      <AuthShell
        title="Create your account"
        subtitle="Start your workspace in seconds"
        footer={
          <>
            Already have an account?{" "}
            <button className="text-foreground underline underline-offset-4" onClick={() => setMode("signin")}>
              Sign in
            </button>
          </>
        }
      >
        <form onSubmit={handleSignup} className="space-y-4">
          <Field label="Full name">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </Field>
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} />
          </Field>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create account
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your workspace"
      footer={
        <>
          New to Helix?{" "}
          <button className="text-foreground underline underline-offset-4" onClick={() => setMode("signup")}>
            Create an account
          </button>
        </>
      }
    >
      <form onSubmit={handleSignin} className="space-y-4">
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </Field>
        <Field
          label="Password"
          aside={
            <Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">
              Forgot?
            </Link>
          }
        >
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

function Field({ label, aside, children }: { label: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
        {aside}
      </div>
      {children}
    </div>
  );
}
