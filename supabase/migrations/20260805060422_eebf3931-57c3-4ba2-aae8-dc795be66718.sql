-- ============ PERMISSIONS ============
CREATE TYPE public.app_permission AS ENUM (
  'workspace.manage',
  'members.invite',
  'members.manage',
  'projects.read',
  'projects.write',
  'tasks.read',
  'tasks.write',
  'tasks.assign',
  'shifts.read',
  'shifts.write',
  'shifts.approve',
  'reports.view'
);

CREATE OR REPLACE FUNCTION public.default_permission(_role public.org_role, _perm public.app_permission)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _role IN ('owner','admin') THEN true
    WHEN _role = 'manager' THEN _perm NOT IN ('workspace.manage','members.manage')
    WHEN _role = 'member' THEN _perm IN ('projects.read','tasks.read','tasks.write','shifts.read','reports.view')
    ELSE _perm IN ('projects.read','tasks.read','shifts.read')
  END
$$;

CREATE TABLE public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.org_role NOT NULL,
  permission public.app_permission NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, role, permission)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read role permissions" ON public.role_permissions
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "Admins manage role permissions" ON public.role_permissions
  FOR ALL TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::org_role[]))
  WITH CHECK (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::org_role[]));
CREATE TRIGGER trg_role_permissions_updated BEFORE UPDATE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.member_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission public.app_permission NOT NULL,
  allowed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, permission)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_permissions TO authenticated;
GRANT ALL ON public.member_permissions TO service_role;
ALTER TABLE public.member_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read own overrides" ON public.member_permissions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::org_role[]));
CREATE POLICY "Admins manage overrides" ON public.member_permissions
  FOR ALL TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::org_role[]))
  WITH CHECK (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::org_role[]));
CREATE TRIGGER trg_member_permissions_updated BEFORE UPDATE ON public.member_permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.has_permission(_org uuid, _user uuid, _perm public.app_permission)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.org_role;
  v_val boolean;
BEGIN
  SELECT role INTO v_role FROM public.organization_members
   WHERE organization_id = _org AND user_id = _user LIMIT 1;
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role = 'owner' THEN RETURN true; END IF;

  SELECT allowed INTO v_val FROM public.member_permissions
   WHERE organization_id = _org AND user_id = _user AND permission = _perm LIMIT 1;
  IF v_val IS NOT NULL THEN RETURN v_val; END IF;

  SELECT allowed INTO v_val FROM public.role_permissions
   WHERE organization_id = _org AND role = v_role AND permission = _perm LIMIT 1;
  IF v_val IS NOT NULL THEN RETURN v_val; END IF;

  RETURN public.default_permission(v_role, _perm);
END $$;

CREATE OR REPLACE FUNCTION public.my_permissions(_org uuid)
RETURNS TABLE(permission public.app_permission, allowed boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.permission, public.has_permission(_org, auth.uid(), p.permission)
  FROM unnest(enum_range(NULL::public.app_permission)) AS p(permission)
$$;

-- ============ JOIN REQUESTS ============
CREATE TYPE public.join_request_status AS ENUM ('pending','approved','declined');

CREATE TABLE public.join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  message text,
  status public.join_request_status NOT NULL DEFAULT 'pending',
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.join_requests TO authenticated;
GRANT ALL ON public.join_requests TO service_role;
ALTER TABLE public.join_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Requester reads own request" ON public.join_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]));
CREATE POLICY "Requester creates own request" ON public.join_requests
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Requester cancels own request" ON public.join_requests
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::org_role[]));
CREATE POLICY "Admins decide requests" ON public.join_requests
  FOR UPDATE TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::org_role[]))
  WITH CHECK (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::org_role[]));
CREATE TRIGGER trg_join_requests_updated BEFORE UPDATE ON public.join_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Join by code OR raise a join request when the email was never invited
CREATE OR REPLACE FUNCTION public.request_or_join_by_code(p_code text, p_message text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := upper(trim(p_code));
  v_org uuid;
  v_org_name text;
  v_invite public.invitations%ROWTYPE;
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_invite FROM public.invitations WHERE upper(code) = v_code LIMIT 1;
  IF FOUND AND lower(v_invite.email) = v_email
     AND v_invite.accepted_at IS NULL AND v_invite.expires_at > now() THEN
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (v_invite.organization_id, v_uid, v_invite.role)
    ON CONFLICT (organization_id, user_id) DO NOTHING;
    UPDATE public.invitations SET accepted_at = now() WHERE id = v_invite.id;
    RETURN jsonb_build_object('status','joined','organization_id', v_invite.organization_id);
  END IF;

  SELECT id, name INTO v_org, v_org_name FROM public.organizations WHERE upper(invite_code) = v_code LIMIT 1;
  IF v_org IS NULL AND v_invite.id IS NOT NULL THEN
    v_org := v_invite.organization_id;
    SELECT name INTO v_org_name FROM public.organizations WHERE id = v_org;
  END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Invalid invite code'; END IF;

  IF public.is_org_member(v_org, v_uid) THEN
    RETURN jsonb_build_object('status','joined','organization_id', v_org);
  END IF;

  -- Email-invited for this workspace? then join straight away
  IF EXISTS (
    SELECT 1 FROM public.invitations i
    WHERE i.organization_id = v_org AND lower(i.email) = v_email
      AND i.accepted_at IS NULL AND i.expires_at > now()
  ) THEN
    INSERT INTO public.organization_members (organization_id, user_id, role)
    SELECT v_org, v_uid, i.role FROM public.invitations i
     WHERE i.organization_id = v_org AND lower(i.email) = v_email AND i.accepted_at IS NULL
     ORDER BY i.created_at DESC LIMIT 1
    ON CONFLICT (organization_id, user_id) DO NOTHING;
    UPDATE public.invitations SET accepted_at = now()
     WHERE organization_id = v_org AND lower(email) = v_email AND accepted_at IS NULL;
    RETURN jsonb_build_object('status','joined','organization_id', v_org);
  END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.join_requests (organization_id, user_id, email, full_name, message)
  VALUES (v_org, v_uid, v_email, v_name, p_message)
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET status = 'pending', message = EXCLUDED.message, decided_by = NULL, decided_at = NULL;

  RETURN jsonb_build_object('status','requested','organization_id', v_org, 'organization_name', v_org_name);
END $$;

CREATE OR REPLACE FUNCTION public.decide_join_request(_request_id uuid, _approve boolean, _role public.org_role DEFAULT 'member')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.join_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.join_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT public.has_org_role(r.organization_id, auth.uid(), ARRAY['owner','admin']::org_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _approve THEN
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (r.organization_id, r.user_id, _role)
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  END IF;

  UPDATE public.join_requests
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'declined' END::public.join_request_status,
         decided_by = auth.uid(), decided_at = now()
   WHERE id = _request_id;
END $$;

-- Let a signed-in user see workspaces where they have a pending request
CREATE OR REPLACE FUNCTION public.my_join_requests()
RETURNS TABLE(id uuid, organization_id uuid, organization_name text, status public.join_request_status, created_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jr.id, jr.organization_id, o.name, jr.status, jr.created_at
  FROM public.join_requests jr
  JOIN public.organizations o ON o.id = jr.organization_id
  WHERE jr.user_id = auth.uid()
$$;