
-- order_index for kanban
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS order_index double precision NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS tasks_status_order_idx ON public.tasks (project_id, status, order_index);

-- comments
CREATE TABLE IF NOT EXISTS public.task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  edited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_comments TO authenticated;
GRANT ALL ON public.task_comments TO service_role;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comments readable to project viewers" ON public.task_comments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND public.can_access_project(t.project_id, auth.uid()))
  );
CREATE POLICY "comments insertable by project members" ON public.task_comments
  FOR INSERT TO authenticated WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND public.can_access_project(t.project_id, auth.uid()))
  );
CREATE POLICY "comments updatable by author" ON public.task_comments
  FOR UPDATE TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY "comments deletable by author or manager" ON public.task_comments
  FOR DELETE TO authenticated USING (
    author_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND public.can_manage_project(t.project_id, auth.uid()))
  );

CREATE TRIGGER trg_task_comments_updated BEFORE UPDATE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS task_comments_task_idx ON public.task_comments (task_id, created_at);

-- activity
CREATE TABLE IF NOT EXISTS public.task_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.task_activity TO authenticated;
GRANT ALL ON public.task_activity TO service_role;
ALTER TABLE public.task_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity readable to project viewers" ON public.task_activity
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND public.can_access_project(t.project_id, auth.uid()))
  );
CREATE POLICY "activity insertable by project members" ON public.task_activity
  FOR INSERT TO authenticated WITH CHECK (
    (actor_id IS NULL OR actor_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND public.can_access_project(t.project_id, auth.uid()))
  );

CREATE INDEX IF NOT EXISTS task_activity_task_idx ON public.task_activity (task_id, created_at DESC);

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_activity;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_labels;
