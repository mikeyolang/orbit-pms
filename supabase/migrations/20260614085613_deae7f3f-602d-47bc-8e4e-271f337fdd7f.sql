-- ============ ENUMS ============
CREATE TYPE public.project_status AS ENUM ('planning','active','on_hold','completed','archived');
CREATE TYPE public.project_visibility AS ENUM ('private','workspace');
CREATE TYPE public.project_member_role AS ENUM ('lead','member','viewer');
CREATE TYPE public.milestone_status AS ENUM ('upcoming','in_progress','completed','cancelled');
CREATE TYPE public.sprint_status AS ENUM ('planned','active','completed','cancelled');
CREATE TYPE public.task_status AS ENUM ('backlog','todo','in_progress','in_review','done','cancelled');
CREATE TYPE public.task_priority AS ENUM ('low','medium','high','urgent');
CREATE TYPE public.task_dependency_type AS ENUM ('blocks','relates_to','duplicates');

-- ============ PROJECTS ============
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  key text NOT NULL,
  description text,
  status public.project_status NOT NULL DEFAULT 'active',
  visibility public.project_visibility NOT NULL DEFAULT 'workspace',
  lead_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  start_date date,
  end_date date,
  color text NOT NULL DEFAULT '#6366f1',
  archived_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- ============ PROJECT MEMBERS ============
CREATE TABLE public.project_members (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.project_member_role NOT NULL DEFAULT 'member',
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated;
GRANT ALL ON public.project_members TO service_role;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

-- ============ MILESTONES ============
CREATE TABLE public.milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  due_date date,
  status public.milestone_status NOT NULL DEFAULT 'upcoming',
  position int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.milestones TO authenticated;
GRANT ALL ON public.milestones TO service_role;
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;

-- ============ SPRINTS ============
CREATE TABLE public.sprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  goal text,
  start_date date,
  end_date date,
  status public.sprint_status NOT NULL DEFAULT 'planned',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sprints TO authenticated;
GRANT ALL ON public.sprints TO service_role;
ALTER TABLE public.sprints ENABLE ROW LEVEL SECURITY;

-- ============ LABELS (org-scoped) ============
CREATE TABLE public.labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#64748b',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.labels TO authenticated;
GRANT ALL ON public.labels TO service_role;
ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;

-- ============ TASKS ============
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  number int NOT NULL,
  parent_task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES public.milestones(id) ON DELETE SET NULL,
  sprint_id uuid REFERENCES public.sprints(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  status public.task_status NOT NULL DEFAULT 'backlog',
  priority public.task_priority NOT NULL DEFAULT 'medium',
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reporter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date timestamptz,
  start_date timestamptz,
  story_points numeric(5,1),
  time_estimate_minutes int,
  time_logged_minutes int NOT NULL DEFAULT 0,
  position double precision NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);
CREATE INDEX idx_tasks_project ON public.tasks(project_id);
CREATE INDEX idx_tasks_assignee ON public.tasks(assignee_id);
CREATE INDEX idx_tasks_status ON public.tasks(project_id, status);
CREATE INDEX idx_tasks_sprint ON public.tasks(sprint_id);
CREATE INDEX idx_tasks_milestone ON public.tasks(milestone_id);
CREATE INDEX idx_tasks_parent ON public.tasks(parent_task_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- ============ TASK LABELS ============
CREATE TABLE public.task_labels (
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES public.labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_labels TO authenticated;
GRANT ALL ON public.task_labels TO service_role;
ALTER TABLE public.task_labels ENABLE ROW LEVEL SECURITY;

-- ============ TASK DEPENDENCIES ============
CREATE TABLE public.task_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  type public.task_dependency_type NOT NULL DEFAULT 'blocks',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, depends_on_task_id, type),
  CHECK (task_id <> depends_on_task_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_dependencies TO authenticated;
GRANT ALL ON public.task_dependencies TO service_role;
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;

-- ============ HELPER FUNCTIONS ============
CREATE OR REPLACE FUNCTION public.is_project_member(_project uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.project_members WHERE project_id = _project AND user_id = _user)
$$;

CREATE OR REPLACE FUNCTION public.can_access_project(_project uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = _project
      AND public.is_org_member(p.organization_id, _user)
      AND (
        p.visibility = 'workspace'
        OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = p.id AND pm.user_id = _user)
        OR public.has_org_role(p.organization_id, _user, ARRAY['owner','admin']::org_role[])
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_project(_project uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = _project
      AND (
        p.created_by = _user
        OR p.lead_id = _user
        OR public.has_org_role(p.organization_id, _user, ARRAY['owner','admin','manager']::org_role[])
        OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = p.id AND pm.user_id = _user AND pm.role = 'lead')
      )
  )
$$;

-- ============ POLICIES: projects ============
CREATE POLICY "view projects in org" ON public.projects FOR SELECT TO authenticated
USING (
  public.is_org_member(organization_id, auth.uid())
  AND (
    visibility = 'workspace'
    OR created_by = auth.uid()
    OR lead_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = id AND pm.user_id = auth.uid())
    OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::org_role[])
  )
);
CREATE POLICY "create projects" ON public.projects FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[])
);
CREATE POLICY "update projects" ON public.projects FOR UPDATE TO authenticated
USING (public.can_manage_project(id, auth.uid()))
WITH CHECK (public.can_manage_project(id, auth.uid()));
CREATE POLICY "delete projects" ON public.projects FOR DELETE TO authenticated
USING (
  created_by = auth.uid()
  OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::org_role[])
);

-- ============ POLICIES: project_members ============
CREATE POLICY "view project members" ON public.project_members FOR SELECT TO authenticated
USING (public.can_access_project(project_id, auth.uid()));
CREATE POLICY "manage project members" ON public.project_members FOR ALL TO authenticated
USING (public.can_manage_project(project_id, auth.uid()))
WITH CHECK (public.can_manage_project(project_id, auth.uid()));

-- ============ POLICIES: milestones ============
CREATE POLICY "view milestones" ON public.milestones FOR SELECT TO authenticated
USING (public.can_access_project(project_id, auth.uid()));
CREATE POLICY "manage milestones" ON public.milestones FOR ALL TO authenticated
USING (public.can_manage_project(project_id, auth.uid()))
WITH CHECK (public.can_manage_project(project_id, auth.uid()) AND created_by = auth.uid());

-- ============ POLICIES: sprints ============
CREATE POLICY "view sprints" ON public.sprints FOR SELECT TO authenticated
USING (public.can_access_project(project_id, auth.uid()));
CREATE POLICY "manage sprints" ON public.sprints FOR ALL TO authenticated
USING (public.can_manage_project(project_id, auth.uid()))
WITH CHECK (public.can_manage_project(project_id, auth.uid()) AND created_by = auth.uid());

-- ============ POLICIES: labels ============
CREATE POLICY "view labels" ON public.labels FOR SELECT TO authenticated
USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "create labels" ON public.labels FOR INSERT TO authenticated
WITH CHECK (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "update labels" ON public.labels FOR UPDATE TO authenticated
USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]))
WITH CHECK (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]));
CREATE POLICY "delete labels" ON public.labels FOR DELETE TO authenticated
USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]));

-- ============ POLICIES: tasks ============
CREATE POLICY "view tasks" ON public.tasks FOR SELECT TO authenticated
USING (public.can_access_project(project_id, auth.uid()));
CREATE POLICY "create tasks" ON public.tasks FOR INSERT TO authenticated
WITH CHECK (public.can_access_project(project_id, auth.uid()) AND created_by = auth.uid());
CREATE POLICY "update tasks" ON public.tasks FOR UPDATE TO authenticated
USING (public.can_access_project(project_id, auth.uid()))
WITH CHECK (public.can_access_project(project_id, auth.uid()));
CREATE POLICY "delete tasks" ON public.tasks FOR DELETE TO authenticated
USING (
  public.can_manage_project(project_id, auth.uid())
  OR created_by = auth.uid()
  OR assignee_id = auth.uid()
);

-- ============ POLICIES: task_labels ============
CREATE POLICY "view task labels" ON public.task_labels FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND public.can_access_project(t.project_id, auth.uid())));
CREATE POLICY "manage task labels" ON public.task_labels FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND public.can_access_project(t.project_id, auth.uid())))
WITH CHECK (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND public.can_access_project(t.project_id, auth.uid())));

-- ============ POLICIES: task_dependencies ============
CREATE POLICY "view task deps" ON public.task_dependencies FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND public.can_access_project(t.project_id, auth.uid())));
CREATE POLICY "manage task deps" ON public.task_dependencies FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND public.can_access_project(t.project_id, auth.uid())))
WITH CHECK (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND public.can_access_project(t.project_id, auth.uid())));

-- ============ TRIGGERS ============
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_milestones_updated BEFORE UPDATE ON public.milestones FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_sprints_updated BEFORE UPDATE ON public.sprints FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-add creator as project lead
CREATE OR REPLACE FUNCTION public.handle_new_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.project_members (project_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'lead')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_project_creator_lead AFTER INSERT ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.handle_new_project();

-- Auto-number tasks per project
CREATE OR REPLACE FUNCTION public.assign_task_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number IS NULL OR NEW.number = 0 THEN
    SELECT COALESCE(MAX(number), 0) + 1 INTO NEW.number
    FROM public.tasks WHERE project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_tasks_number BEFORE INSERT ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.assign_task_number();

-- Auto-set completed_at when status -> done
CREATE OR REPLACE FUNCTION public.task_completion_stamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    NEW.completed_at = now();
  ELSIF NEW.status <> 'done' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_task_completion BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.task_completion_stamp();