ALTER TABLE public.shift_swap_requests ADD COLUMN IF NOT EXISTS preferred_start_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.shift_swap_requests ADD COLUMN IF NOT EXISTS preferred_end_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.shift_settings ADD COLUMN IF NOT EXISTS hr_integration_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE public.shift_settings ADD COLUMN IF NOT EXISTS hr_system_name text;
--> statement-breakpoint
ALTER TABLE public.shift_settings ADD COLUMN IF NOT EXISTS hr_webhook_url text;
--> statement-breakpoint
DROP POLICY IF EXISTS "managers delete shifts" ON public.shifts;
--> statement-breakpoint
CREATE POLICY "permitted users delete shifts" ON public.shifts FOR DELETE TO authenticated
  USING (public.has_permission(organization_id,auth.uid(),'shifts.delete'::public.app_permission));
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.apply_shift_swap(uuid);
--> statement-breakpoint
CREATE FUNCTION public.apply_shift_swap(_request_id uuid, _assignee_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.shift_swap_requests%ROWTYPE; actor uuid:=auth.uid(); is_manager boolean; replacement uuid;
BEGIN
  SELECT * INTO r FROM public.shift_swap_requests WHERE id=_request_id FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('pending','approved') THEN RAISE EXCEPTION 'Swap request is no longer active'; END IF;
  is_manager:=public.has_org_role(r.organization_id,actor,ARRAY['owner','admin','manager']::public.org_role[]);
  IF r.kind='direct' THEN IF actor<>r.to_user_id AND NOT is_manager THEN RAISE EXCEPTION 'Only the requested teammate can accept'; END IF; replacement:=COALESCE(_assignee_id,r.to_user_id);
  ELSIF r.kind='open' THEN IF NOT public.is_org_member(r.organization_id,actor) THEN RAISE EXCEPTION 'Not authorized'; END IF; replacement:=COALESCE(_assignee_id,actor);
  ELSE IF NOT is_manager THEN RAISE EXCEPTION 'A manager must assign coverage'; END IF; replacement:=_assignee_id; END IF;
  IF replacement IS NULL OR NOT public.is_org_member(r.organization_id,replacement) THEN RAISE EXCEPTION 'Choose a workspace member to take the shift'; END IF;
  UPDATE public.shifts SET user_id=replacement,start_at=COALESCE(r.preferred_start_at,start_at),end_at=COALESCE(r.preferred_end_at,end_at) WHERE id=r.from_shift_id;
  UPDATE public.shift_swap_requests SET to_user_id=replacement,status='accepted',decided_by=actor,decided_at=now() WHERE id=r.id;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.apply_shift_swap(uuid,uuid) TO authenticated;
