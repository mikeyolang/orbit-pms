ALTER TABLE public.invitations ADD COLUMN team_id uuid;
--> statement-breakpoint
ALTER TABLE public.teams ADD CONSTRAINT teams_id_organization_unique UNIQUE (id, organization_id);
--> statement-breakpoint
ALTER TABLE public.invitations ADD CONSTRAINT invitations_team_organization_fk
  FOREIGN KEY (team_id, organization_id) REFERENCES public.teams(id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX invitations_team_idx ON public.invitations(team_id);
--> statement-breakpoint
CREATE UNIQUE INDEX invitations_team_pending_email_unique ON public.invitations(team_id, lower(email))
  WHERE team_id IS NOT NULL AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.my_pending_invites()
RETURNS TABLE (id uuid, organization_id uuid, organization_name text, role public.org_role, token text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT i.id,i.organization_id,o.name,i.role,i.token,i.expires_at
  FROM invitations i JOIN organizations o ON o.id=i.organization_id
  WHERE lower(i.email)=lower(coalesce(auth.jwt()->>'email',''))
    AND i.accepted_at IS NULL AND i.declined_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()
    AND (i.team_id IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM organization_members m WHERE m.organization_id=i.organization_id AND m.user_id=auth.uid()
    ))
$$;
--> statement-breakpoint
-- Keep generic invitation writes subject to the same team management boundary.
CREATE POLICY "Team invitations require team management" ON public.invitations AS RESTRICTIVE FOR ALL TO authenticated
  USING (team_id IS NULL OR public.has_org_role(organization_id,auth.uid(),ARRAY['owner','admin','manager']::public.org_role[]))
  WITH CHECK (team_id IS NULL OR public.has_org_role(organization_id,auth.uid(),ARRAY['owner','admin','manager']::public.org_role[]));
