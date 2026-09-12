import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, BarChart3, BellRing, CalendarClock, FileText, KanbanSquare, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Voltic PMS — Projects, Shifts and Team Operations" },
      {
        name: "description",
        content:
          "Plan projects, coordinate shifts, manage teams, and turn daily operations into clear reports.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    authClient.getSession().then(({ data }) => {
      if (!active) return;
      if (data?.session) {
        setSignedIn(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2.5 font-bold tracking-tight">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#1B3673] text-xs text-white shadow-md">V</div>
            <span className="text-lg">Voltic PMS</span>
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
                  <Button variant="ghost" size="sm">
                    Sign in
                  </Button>
                </Link>
                <Link to="/auth" search={{ mode: "signup" }}>
                  <Button size="sm">Get started</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main>
        <section className="relative overflow-hidden px-6 py-24 text-center md:py-32">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(27,54,115,0.12),transparent_35%),radial-gradient(circle_at_top_right,rgba(27,54,115,0.12),transparent_35%)]" />
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            One workspace for projects, people and shifts
          </div>
          <h1 className="mx-auto max-w-4xl text-5xl font-bold tracking-tight md:text-6xl">
            Keep every team moving,{" "}
            <span className="text-[#1B3673] dark:text-blue-300">all in one place.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base text-muted-foreground">
            Plan projects, coordinate shifts, manage your team, and turn daily work into clear reports—all from one calm, connected workspace.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link to="/auth" search={{ mode: "signup" }}>
              <Button size="lg" className="gap-2 bg-[#1B3673] text-white shadow-lg shadow-[#1B3673]/20 hover:bg-[#142A5C]">
                Create your workspace <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="/auth">
              <Button size="lg" variant="outline" className="bg-white/70 dark:bg-slate-950/70">
                Sign in
              </Button>
            </Link>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold tracking-tight">Everything your team needs to stay aligned</h2>
            <p className="mt-2 text-sm text-muted-foreground">A consistent view of delivery, staffing, performance, and accountability.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: KanbanSquare,
              title: "Projects & tasks",
              body: "Plan work with boards, sprints, milestones, assignments, approvals, and clear deadlines.",
              color: "from-blue-600 to-indigo-600",
            },
            {
              icon: Users,
              title: "Team & roles",
              body: "Invite people by email and control access with built-in or customized roles and permissions.",
              color: "from-violet-600 to-purple-600",
            },
            {
              icon: CalendarClock,
              title: "Shift management",
              body: "Schedule shifts, manage swaps, check in and out, and preserve handover notes for the next team.",
              color: "from-cyan-600 to-blue-600",
            },
            {
              icon: FileText,
              title: "Shift reports",
              body: "Capture ticket and chat activity, review individual history, and generate detailed PDF reports.",
              color: "from-emerald-600 to-teal-600",
            },
            {
              icon: BarChart3,
              title: "Useful dashboards",
              body: "See project health, workload, upcoming shifts, operational trends, and performance summaries.",
              color: "from-amber-500 to-orange-600",
            },
            {
              icon: BellRing,
              title: "Timely notifications",
              body: "Keep the right people informed about invitations, shift requests, and overdue project work.",
              color: "from-rose-600 to-pink-600",
            },
          ].map((f) => (
            <div key={f.title} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg dark:border-slate-800 dark:bg-slate-950">
              <div className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${f.color} text-white shadow-sm`}>
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{f.body}</p>
            </div>
          ))}
          </div>
        </section>
        <section className="bg-gradient-to-r from-indigo-950 via-violet-950 to-slate-950 px-6 py-16 text-center text-white">
          <ShieldCheck className="mx-auto h-8 w-8 text-indigo-300" />
          <h2 className="mt-4 text-2xl font-bold">Ready to bring your work together?</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-indigo-100/75">Create a workspace, invite your team, and choose exactly which parts of the system each person can access.</p>
          <Link to="/auth" search={{ mode: "signup" }}>
            <Button size="lg" className="mt-6 gap-2 bg-white text-indigo-950 hover:bg-indigo-50">Get started <ArrowRight className="h-4 w-4" /></Button>
          </Link>
        </section>
      </main>
    </div>
  );
}
