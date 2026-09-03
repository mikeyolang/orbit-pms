CREATE OR REPLACE FUNCTION public.can_manage_project(_project uuid,_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM projects p WHERE p.id=_project AND public.has_module_access(p.organization_id,_user,'projects') AND (p.created_by=_user OR p.lead_id=_user OR public.has_org_role(p.organization_id,_user,ARRAY['owner','admin','manager']::public.org_role[]) OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=_user AND pm.role='lead'))) $$;
--> statement-breakpoint
DROP POLICY IF EXISTS "create projects" ON public.projects;
--> statement-breakpoint
CREATE POLICY "create projects" ON public.projects FOR INSERT TO authenticated WITH CHECK(created_by=auth.uid() AND public.has_module_access(organization_id,auth.uid(),'projects') AND public.has_org_role(organization_id,auth.uid(),ARRAY['owner','admin','manager']::public.org_role[]));
--> statement-breakpoint
DROP POLICY IF EXISTS "managers insert shifts" ON public.shifts;
--> statement-breakpoint
CREATE POLICY "managers insert shifts" ON public.shifts FOR INSERT TO authenticated WITH CHECK(public.has_module_access(organization_id,auth.uid(),'shifts') AND public.has_permission(organization_id,auth.uid(),'shifts.write'));
--> statement-breakpoint
DROP POLICY IF EXISTS "managers update any shift" ON public.shifts;
--> statement-breakpoint
CREATE POLICY "managers update any shift" ON public.shifts FOR UPDATE TO authenticated USING(public.has_module_access(organization_id,auth.uid(),'shifts') AND public.has_permission(organization_id,auth.uid(),'shifts.write')) WITH CHECK(public.has_module_access(organization_id,auth.uid(),'shifts') AND public.has_permission(organization_id,auth.uid(),'shifts.write'));
--> statement-breakpoint
DROP POLICY IF EXISTS "permitted users delete shifts" ON public.shifts;
--> statement-breakpoint
CREATE POLICY "permitted users delete shifts" ON public.shifts FOR DELETE TO authenticated USING(public.has_module_access(organization_id,auth.uid(),'shifts') AND public.has_permission(organization_id,auth.uid(),'shifts.delete'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.require_checkout_report() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.status='ended' AND OLD.status<>'ended' AND NEW.user_id=auth.uid() AND NOT EXISTS(SELECT 1 FROM shift_reports r WHERE r.shift_id=NEW.id) THEN RAISE EXCEPTION 'Submit the checkout report before ending your shift'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_require_checkout_report BEFORE UPDATE OF status ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.require_checkout_report();
