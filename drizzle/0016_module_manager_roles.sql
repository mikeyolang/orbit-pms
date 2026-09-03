ALTER TABLE public.custom_roles ADD COLUMN IF NOT EXISTS can_access_projects boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE public.custom_roles ADD COLUMN IF NOT EXISTS can_access_shifts boolean NOT NULL DEFAULT true;
--> statement-breakpoint
INSERT INTO public.custom_roles(organization_id,name,description,base_role,can_access_projects,can_access_shifts)
SELECT id,'Shift Manager','Manages scheduling, coverage, companies and shift reports.','manager',false,true FROM public.organizations ON CONFLICT(organization_id,name) DO NOTHING;
--> statement-breakpoint
INSERT INTO public.custom_roles(organization_id,name,description,base_role,can_access_projects,can_access_shifts)
SELECT id,'Project Manager','Manages projects, tasks and project teams.','manager',true,false FROM public.organizations ON CONFLICT(organization_id,name) DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.latest_shift_handover(_org uuid) RETURNS TABLE(handover_notes text,checked_out_at timestamptz,member_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT r.handover_notes,r.checked_out_at,COALESCE(p.full_name,u.name,u.email) FROM shift_reports r JOIN "user" u ON u.id=r.user_id LEFT JOIN profiles p ON p.id=r.user_id WHERE r.organization_id=_org AND r.handover_notes IS NOT NULL AND trim(r.handover_notes)<>'' AND public.has_module_access(_org,auth.uid(),'shifts') ORDER BY r.checked_out_at DESC LIMIT 1
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.latest_shift_handover(uuid) TO authenticated;
