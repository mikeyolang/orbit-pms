ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES public."user"(id) ON DELETE SET NULL;
--> statement-breakpoint
DROP POLICY IF EXISTS "Admins create invitations" ON public.invitations;
--> statement-breakpoint
CREATE POLICY "Permitted members create scoped invitations" ON public.invitations FOR INSERT TO authenticated WITH CHECK (
 invited_by=auth.uid() AND public.has_permission(organization_id,auth.uid(),'members.invite') AND (
  public.has_org_role(organization_id,auth.uid(),ARRAY['owner','admin']::public.org_role[]) OR
  EXISTS(SELECT 1 FROM organization_members me WHERE me.organization_id=invitations.organization_id AND me.user_id=auth.uid() AND (NOT invitations.can_access_projects OR me.can_access_projects) AND (NOT invitations.can_access_shifts OR me.can_access_shifts) AND invitations.role IN ('member','viewer'))
 )
);
--> statement-breakpoint
CREATE POLICY "Inviters view own invitations" ON public.invitations FOR SELECT TO authenticated USING(invited_by=auth.uid());
