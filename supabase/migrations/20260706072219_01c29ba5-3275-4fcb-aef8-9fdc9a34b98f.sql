ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sprints;
ALTER PUBLICATION supabase_realtime ADD TABLE public.milestones;
ALTER TABLE public.projects REPLICA IDENTITY FULL;
ALTER TABLE public.sprints REPLICA IDENTITY FULL;
ALTER TABLE public.milestones REPLICA IDENTITY FULL;
ALTER TABLE public.tasks REPLICA IDENTITY FULL;