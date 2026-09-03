ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS can_access_projects boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS can_access_shifts boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS can_access_projects boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS can_access_shifts boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.has_module_access(_org uuid,_user uuid,_module text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM organization_members m WHERE m.organization_id=_org AND m.user_id=_user AND CASE WHEN m.role IN ('owner','admin') THEN true WHEN _module='projects' THEN m.can_access_projects WHEN _module='shifts' THEN m.can_access_shifts ELSE false END) $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.can_access_project(_project uuid,_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.projects p WHERE p.id=_project AND public.has_module_access(p.organization_id,_user,'projects') AND (p.visibility='workspace' OR EXISTS(SELECT 1 FROM public.project_members pm WHERE pm.project_id=p.id AND pm.user_id=_user) OR public.has_org_role(p.organization_id,_user,ARRAY['owner','admin']::public.org_role[]))) $$;
--> statement-breakpoint
DROP POLICY IF EXISTS "view projects in org" ON public.projects;
--> statement-breakpoint
CREATE POLICY "view projects in org" ON public.projects FOR SELECT TO authenticated USING(public.has_module_access(organization_id,auth.uid(),'projects') AND (visibility='workspace' OR created_by=auth.uid() OR lead_id=auth.uid() OR EXISTS(SELECT 1 FROM public.project_members pm WHERE pm.project_id=id AND pm.user_id=auth.uid()) OR public.has_org_role(organization_id,auth.uid(),ARRAY['owner','admin']::public.org_role[])));
--> statement-breakpoint
DROP POLICY IF EXISTS "members view shifts" ON public.shifts;
--> statement-breakpoint
CREATE POLICY "members view shifts" ON public.shifts FOR SELECT TO authenticated USING(public.has_module_access(organization_id,auth.uid(),'shifts'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.bus_companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,name text NOT NULL,is_active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,name)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.shift_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shift_id uuid NOT NULL UNIQUE REFERENCES public.shifts(id) ON DELETE CASCADE,organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES public."user"(id),
 checked_in_at timestamptz,checked_out_at timestamptz NOT NULL DEFAULT now(),unreached_clients integer NOT NULL DEFAULT 0,vouchers_issued integer NOT NULL DEFAULT 0,cancelled_tickets integer NOT NULL DEFAULT 0,handover_notes text,
 total_tickets integer NOT NULL DEFAULT 0,total_value numeric(14,2) NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.shift_report_companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),report_id uuid NOT NULL REFERENCES public.shift_reports(id) ON DELETE CASCADE,company_id uuid NOT NULL REFERENCES public.bus_companies(id),tickets_sold integer NOT NULL DEFAULT 0,total_value numeric(14,2) NOT NULL DEFAULT 0,UNIQUE(report_id,company_id)
);
--> statement-breakpoint
ALTER TABLE public.bus_companies ENABLE ROW LEVEL SECURITY; ALTER TABLE public.shift_reports ENABLE ROW LEVEL SECURITY; ALTER TABLE public.shift_report_companies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE,DELETE ON public.bus_companies,public.shift_reports,public.shift_report_companies TO authenticated;
--> statement-breakpoint
CREATE POLICY "shift users view companies" ON public.bus_companies FOR SELECT TO authenticated USING(public.has_module_access(organization_id,auth.uid(),'shifts'));
--> statement-breakpoint
CREATE POLICY "shift managers manage companies" ON public.bus_companies FOR ALL TO authenticated USING(public.has_permission(organization_id,auth.uid(),'shifts.write')) WITH CHECK(public.has_permission(organization_id,auth.uid(),'shifts.write'));
--> statement-breakpoint
CREATE POLICY "users and managers view reports" ON public.shift_reports FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.has_permission(organization_id,auth.uid(),'shifts.approve'));
--> statement-breakpoint
CREATE POLICY "users create own reports" ON public.shift_reports FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND public.has_module_access(organization_id,auth.uid(),'shifts'));
--> statement-breakpoint
CREATE POLICY "report viewers see company totals" ON public.shift_report_companies FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM shift_reports r WHERE r.id=report_id AND (r.user_id=auth.uid() OR public.has_permission(r.organization_id,auth.uid(),'shifts.approve'))));
--> statement-breakpoint
CREATE POLICY "users add own company totals" ON public.shift_report_companies FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM shift_reports r WHERE r.id=report_id AND r.user_id=auth.uid()));
