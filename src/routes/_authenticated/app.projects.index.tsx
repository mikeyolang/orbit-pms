import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/components/app/app-shell";
import { NewProjectDialog } from "@/components/app/new-project-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FolderKanban, Loader2, Plus } from "lucide-react";
import type { Project } from "@/lib/projects";

export const Route = createFileRoute("/_authenticated/app/projects/")({
  component: ProjectsIndex,
});

function ProjectsIndex() {
  const { currentOrg, role } = useOrg();
  const canCreate = role === "owner" || role === "admin" || role === "manager";
  const [projects, setProjects] = useState<Project[] | null>(null);

  useEffect(() => {
    supabase
      .from("projects")
      .select("*")
      .eq("organization_id", currentOrg.organization_id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .then(({ data }) => setProjects(data ?? []));
  }, [currentOrg.organization_id]);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Plan work and track progress across teams.</p>
        </div>
        {canCreate && <NewProjectDialog />}
      </div>

      {projects === null ? (
        <div className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : projects.length === 0 ? (
        <div className="mt-12 flex flex-col items-center rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-16 text-center">
          <FolderKanban className="h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 text-sm font-medium">No projects yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">Create your first project to start tracking work.</p>
          {canCreate && (
            <div className="mt-5">
              <NewProjectDialog trigger={<Button size="sm"><Plus className="h-4 w-4" />Create project</Button>} />
            </div>
          )}
        </div>
      ) : (
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              to="/app/projects/$key"
              params={{ key: p.key }}
              className="group rounded-xl border border-border/60 bg-card/40 p-5 transition-colors hover:border-border hover:bg-card/70"
            >
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: p.color }} />
                <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{p.key}</span>
                <Badge variant="outline" className="ml-auto text-[10px] capitalize">{p.status}</Badge>
              </div>
              <h3 className="mt-3 text-base font-medium group-hover:text-foreground">{p.name}</h3>
              {p.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
