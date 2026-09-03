ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS require_task_creation_approval boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS require_task_completion_approval boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS approval_state text NOT NULL DEFAULT 'approved';
--> statement-breakpoint
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS requested_status public.task_status;
--> statement-breakpoint
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS approval_requested_by uuid REFERENCES public."user"(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS approval_reviewed_by uuid REFERENCES public."user"(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS approval_reviewed_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS approval_rejection_reason text;
--> statement-breakpoint
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_approval_state_check;
--> statement-breakpoint
ALTER TABLE public.tasks ADD CONSTRAINT tasks_approval_state_check CHECK (approval_state IN ('approved','pending_creation','pending_completion','rejected'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.apply_task_approval_rules()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_org uuid; v_role public.org_role; v_create boolean; v_complete boolean; v_user uuid := auth.uid();
BEGIN
  SELECT p.organization_id, o.require_task_creation_approval, o.require_task_completion_approval
    INTO v_org, v_create, v_complete FROM public.projects p JOIN public.organizations o ON o.id=p.organization_id WHERE p.id=NEW.project_id;
  SELECT role INTO v_role FROM public.organization_members WHERE organization_id=v_org AND user_id=v_user LIMIT 1;
  IF TG_OP='INSERT' AND v_create AND v_role IN ('member','viewer') THEN
    NEW.approval_state := 'pending_creation'; NEW.approval_requested_by := v_user;
  ELSIF TG_OP='UPDATE' AND NEW.status='done' AND OLD.status<>'done' AND v_complete AND v_role IN ('member','viewer') THEN
    NEW.status := OLD.status; NEW.requested_status := 'done'; NEW.approval_state := 'pending_completion'; NEW.approval_requested_by := v_user;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_task_approval_rules ON public.tasks;
--> statement-breakpoint
CREATE TRIGGER trg_task_approval_rules BEFORE INSERT OR UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.apply_task_approval_rules();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notify_task_approval_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid;
BEGIN
  IF NEW.approval_state IN ('pending_creation','pending_completion') AND (TG_OP='INSERT' OR OLD.approval_state IS DISTINCT FROM NEW.approval_state) THEN
    SELECT organization_id INTO v_org FROM public.projects WHERE id=NEW.project_id;
    INSERT INTO public.system_notifications(user_id,kind,title,body,href,dedupe_key)
    SELECT m.user_id,'task-approval',CASE WHEN NEW.approval_state='pending_creation' THEN 'Task needs approval' ELSE 'Completion needs approval' END,
      NEW.title,'/app/settings','task-approval:'||NEW.id||':'||NEW.approval_state
    FROM public.organization_members m WHERE m.organization_id=v_org AND m.role IN ('owner','admin','manager')
    ON CONFLICT (user_id,dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_notify_task_approval_request ON public.tasks;
--> statement-breakpoint
CREATE TRIGGER trg_notify_task_approval_request AFTER INSERT OR UPDATE OF approval_state ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.notify_task_approval_request();
--> statement-breakpoint
DROP POLICY IF EXISTS "view tasks" ON public.tasks;
--> statement-breakpoint
CREATE POLICY "view tasks" ON public.tasks FOR SELECT TO authenticated USING (
  public.can_access_project(project_id, auth.uid()) AND (
    approval_state NOT IN ('pending_creation','rejected') OR created_by=auth.uid() OR
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id=project_id AND public.has_org_role(p.organization_id,auth.uid(),ARRAY['owner','admin','manager']::public.org_role[]))
  )
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.decide_task_approval(_task uuid, _approve boolean, _reason text DEFAULT NULL)
RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_task public.tasks; v_org uuid;
BEGIN
  SELECT t.* INTO v_task FROM public.tasks t WHERE t.id=_task;
  SELECT p.organization_id INTO v_org FROM public.tasks t JOIN public.projects p ON p.id=t.project_id WHERE t.id=_task;
  IF v_task.id IS NULL OR NOT public.has_org_role(v_org,auth.uid(),ARRAY['owner','admin','manager']::public.org_role[]) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF v_task.approval_state NOT IN ('pending_creation','pending_completion') THEN RAISE EXCEPTION 'Task has no pending approval'; END IF;
  UPDATE public.tasks SET
    status=CASE WHEN _approve AND approval_state='pending_completion' THEN COALESCE(requested_status,status) ELSE status END,
    approval_state=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    requested_status=NULL, approval_reviewed_by=auth.uid(), approval_reviewed_at=now(), approval_rejection_reason=CASE WHEN _approve THEN NULL ELSE NULLIF(trim(_reason),'') END
  WHERE id=_task RETURNING * INTO v_task;
  IF v_task.approval_requested_by IS NOT NULL THEN
    INSERT INTO public.system_notifications(user_id,kind,title,body,href,dedupe_key) VALUES
      (v_task.approval_requested_by,'task-approval-result',CASE WHEN _approve THEN 'Task approved' ELSE 'Task rejected' END,
       CASE WHEN _approve THEN v_task.title ELSE v_task.title||COALESCE(': '||NULLIF(trim(_reason),''),'') END,NULL,'task-approval-result:'||v_task.id||':'||extract(epoch from v_task.approval_reviewed_at))
    ON CONFLICT (user_id,dedupe_key) DO NOTHING;
  END IF;
  RETURN v_task;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.decide_task_approval(uuid,boolean,text) TO authenticated;
