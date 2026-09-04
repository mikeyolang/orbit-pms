import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";

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
  const [confirmPassword, setConfirmPassword] = useState("");

  // Already signed in? Keep the session and go straight into the app.
  useEffect(() => {
    let active = true;
    authClient.getSession().then(({ data }) => {
      if (active && data?.session && !invite) navigate({ to: "/app", replace: true });
    });
    return () => {
      active = false;
    };
  }, [invite, navigate]);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z
      .object({
        fullName: z.string().trim().min(1, "Name is required").max(80),
        email: z.string().trim().email("Invalid email").max(255),
        password: z.string().min(8, "Password must be at least 8 characters").max(72),
        confirmPassword: z.string().min(1, "Please confirm your password"),
      })
      .refine((values) => values.password === values.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
      })
      .safeParse({ fullName, email, password, confirmPassword });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await authClient.signUp.email({
      name: parsed.data.fullName,
      email: parsed.data.email,
      password: parsed.data.password,
      callbackURL: invite ? `/accept-invite/${invite}?accept=1` : "/app",
    });
    if (error) {
      setLoading(false);
      toast.error(error.message);
      return;
    }
    setLoading(false);
    toast.success("Account created. Check your email to verify it.");
    navigate({ to: "/verify-email", search: { email: parsed.data.email, invite } });
  }

  async function handleSignin(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z
      .object({
        email: z.string().trim().email("Invalid email"),
        password: z.string().min(1, "Password is required"),
      })
      .safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await authClient.signIn.email({ ...parsed.data, callbackURL: "/app" });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Signed in");
    if (invite) {
      navigate({ to: "/accept-invite/$token", params: { token: invite } });
    } else {
      navigate({ to: "/app" });
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
            <button
              className="text-foreground underline underline-offset-4"
              onClick={() => setMode("signin")}
            >
              Sign in
            </button>
          </>
        }
      >
        <form onSubmit={handleSignup} className="space-y-4">
          <Field label="Full name">
            <Input
              className="h-11 bg-white dark:bg-slate-950"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              required
            />
          </Field>
          <Field label="Email">
            <Input
              className="h-11 bg-white dark:bg-slate-950"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Password">
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </Field>
          <Field label="Confirm password">
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </Field>
          <Button type="submit" className="w-full bg-[#1B3673] text-white hover:bg-[#142A5C]" disabled={loading}>
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
          <button
            className="text-foreground underline underline-offset-4"
            onClick={() => setMode("signup")}
          >
            Create an account
          </button>
        </>
      }
    >
      <form onSubmit={handleSignin} className="space-y-4">
        <Field label="Email">
          <Input
            className="h-11 bg-white dark:bg-slate-950"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </Field>
        <Field
          label="Password"
          aside={
            <Link
              to="/forgot-password"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Forgot?
            </Link>
          }
        >
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <Button type="submit" className="w-full bg-[#1B3673] text-white hover:bg-[#142A5C]" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="h-11 bg-white pr-11 dark:bg-slate-950" />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground transition-colors hover:text-foreground"
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function Field({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
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
