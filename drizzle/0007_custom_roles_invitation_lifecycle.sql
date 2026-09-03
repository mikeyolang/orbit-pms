ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.custom_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  base_role public.org_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_roles_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT custom_roles_base_role_safe CHECK (base_role IN ('manager','member','viewer')),
  UNIQUE (organization_id, name)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.custom_role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_role_id uuid NOT NULL REFERENCES public.custom_roles(id) ON DELETE CASCADE,
  permission public.app_permission NOT NULL,
  allowed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (custom_role_id, permission)
);
--> statement-breakpoint
ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS custom_role_id uuid REFERENCES public.custom_roles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS custom_role_id uuid REFERENCES public.custom_roles(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS custom_roles_org_idx ON public.custom_roles(organization_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS organization_members_custom_role_idx ON public.organization_members(custom_role_id);
--> statement-breakpoint
ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.custom_role_permissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_roles, public.custom_role_permissions TO authenticated;
--> statement-breakpoint
CREATE POLICY "Members read custom roles" ON public.custom_roles FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));
--> statement-breakpoint
CREATE POLICY "Admins manage custom roles" ON public.custom_roles FOR ALL TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[]))
  WITH CHECK (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[]));
--> statement-breakpoint
CREATE POLICY "Members read custom role permissions" ON public.custom_role_permissions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.custom_roles r WHERE r.id=custom_role_id AND public.is_org_member(r.organization_id, auth.uid())));
--> statement-breakpoint
CREATE POLICY "Admins manage custom role permissions" ON public.custom_role_permissions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.custom_roles r WHERE r.id=custom_role_id AND public.has_org_role(r.organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.custom_roles r WHERE r.id=custom_role_id AND public.has_org_role(r.organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[])));
--> statement-breakpoint
DROP POLICY IF EXISTS "Invitees accept (update)" ON public.invitations;
--> statement-breakpoint
CREATE POLICY "Admins update invitations" ON public.invitations FOR UPDATE TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[]))
  WITH CHECK (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[]));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.has_permission(_org uuid, _user uuid, _perm public.app_permission)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_role public.org_role; v_custom_role uuid; v_val boolean;
BEGIN
  SELECT role, custom_role_id INTO v_role, v_custom_role FROM public.organization_members
    WHERE organization_id=_org AND user_id=_user LIMIT 1;
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role='owner' THEN RETURN true; END IF;
  SELECT allowed INTO v_val FROM public.member_permissions
    WHERE organization_id=_org AND user_id=_user AND permission=_perm LIMIT 1;
  IF v_val IS NOT NULL THEN RETURN v_val; END IF;
  IF v_custom_role IS NOT NULL THEN
    SELECT allowed INTO v_val FROM public.custom_role_permissions
      WHERE custom_role_id=v_custom_role AND permission=_perm LIMIT 1;
    IF v_val IS NOT NULL THEN RETURN v_val; END IF;
  END IF;
  SELECT allowed INTO v_val FROM public.role_permissions
    WHERE organization_id=_org AND role=v_role AND permission=_perm LIMIT 1;
  IF v_val IS NOT NULL THEN RETURN v_val; END IF;
  RETURN public.default_permission(v_role, _perm);
END $$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.my_pending_invites();
--> statement-breakpoint
CREATE FUNCTION public.my_pending_invites() RETURNS TABLE (id uuid, organization_id uuid, organization_name text, role public.org_role, token text, expires_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT i.id,i.organization_id,o.name,i.role,i.token,i.expires_at FROM invitations i JOIN organizations o ON o.id=i.organization_id WHERE lower(i.email)=lower(coalesce(auth.jwt()->>'email','')) AND i.accepted_at IS NULL AND i.declined_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.organization_id=i.organization_id AND m.user_id=auth.uid())
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.my_pending_invites() TO authenticated;
