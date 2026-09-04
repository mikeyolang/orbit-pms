ALTER TABLE public.sprints
ADD COLUMN IF NOT EXISTS milestone_id uuid REFERENCES public.milestones(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sprints_milestone_idx ON public.sprints(milestone_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_sprint_milestone_project()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.milestone_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.milestones m
    WHERE m.id = NEW.milestone_id AND m.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'Sprint and milestone must belong to the same project';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_sprint_milestone_project ON public.sprints;
--> statement-breakpoint
CREATE TRIGGER trg_sprint_milestone_project
BEFORE INSERT OR UPDATE OF milestone_id, project_id ON public.sprints
FOR EACH ROW EXECUTE FUNCTION public.validate_sprint_milestone_project();
