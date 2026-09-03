import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, KanbanSquare, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Helix — Project Management for Fast Teams" },
      { name: "description", content: "Plan sprints, track tasks, and ship together. A modern PM tool inspired by Linear." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        setSignedIn(true);
        navigate({ to: "/onboarding", replace: true });
      }
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-primary to-primary/60" />
            Helix
          </Link>
          <div className="flex items-center gap-2">
            {signedIn ? (
              <Link to="/onboarding">
                <Button size="sm" className="gap-1.5">
                  Open app <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/auth">
                  <Button variant="ghost" size="sm">Sign in</Button>
                </Link>
                <Link to="/auth" search={{ mode: "signup" }}>
                  <Button size="sm">Get started</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6">
        <section className="py-24 text-center">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Phase 1 — Auth & Organizations
          </div>
          <h1 className="mx-auto max-w-3xl text-5xl font-semibold tracking-tight md:text-6xl">
            Project management <span className="text-muted-foreground">that gets out of the way.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base text-muted-foreground">
            Plan sprints, track tasks across Kanban and flowcharts, and hold the team accountable — all in one calm, fast workspace.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link to="/auth" search={{ mode: "signup" }}>
              <Button size="lg" className="gap-2">
                Create your workspace <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="/auth">
              <Button size="lg" variant="ghost">Sign in</Button>
            </Link>
          </div>
        </section>
        <section className="grid gap-4 pb-24 md:grid-cols-3">
          {[
            { icon: KanbanSquare, title: "Kanban + Scrum", body: "Drag-and-drop boards, sprints, burndown — coming next." },
            { icon: Users, title: "Team & roles", body: "Owner, Admin, Manager, Member, Viewer — fine-grained." },
            { icon: CheckCircle2, title: "Accountability", body: "Overdue alerts, missed-deadline log, daily digest." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-border/60 bg-card/50 p-5">
              <f.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-sm font-medium">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
