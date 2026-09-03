-- 8-char random code generator
CREATE OR REPLACE FUNCTION public.gen_invite_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := '';
  i int;
BEGIN
  FOR i IN 1..8 LOOP
    out := out || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  END LOOP;
  RETURN out;
END;
$$;

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS invite_code text;
UPDATE public.organizations SET invite_code = public.gen_invite_code() WHERE invite_code IS NULL;
ALTER TABLE public.organizations ALTER COLUMN invite_code SET DEFAULT public.gen_invite_code();
ALTER TABLE public.organizations ALTER COLUMN invite_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_invite_code_key ON public.organizations (invite_code);

ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS code text;
UPDATE public.invitations SET code = public.gen_invite_code() WHERE code IS NULL;
ALTER TABLE public.invitations ALTER COLUMN code SET DEFAULT public.gen_invite_code();
ALTER TABLE public.invitations ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invitations_code_key ON public.invitations (code);

-- Users can see invitations addressed to their own email
DROP POLICY IF EXISTS "Users can view invitations for their email" ON public.invitations;
CREATE POLICY "Users can view invitations for their email"
  ON public.invitations FOR SELECT TO authenticated
  USING (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- List pending invites for the signed-in user
CREATE OR REPLACE FUNCTION public.my_pending_invites()
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  organization_name text,
  role public.org_role,
  code text,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.organization_id, o.name, i.role, i.code, i.expires_at
  FROM public.invitations i
  JOIN public.organizations o ON o.id = i.organization_id
  WHERE lower(i.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    AND i.accepted_at IS NULL
    AND i.expires_at > now()
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = i.organization_id AND m.user_id = auth.uid()
    );
$$;

-- Join a workspace using either a workspace invite code or a personal invitation code
CREATE OR REPLACE FUNCTION public.join_org_by_code(p_code text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := upper(trim(p_code));
  v_org uuid;
  v_role public.org_role := 'member';
  v_invite public.invitations%ROWTYPE;
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_invite FROM public.invitations WHERE upper(code) = v_code LIMIT 1;
  IF FOUND THEN
    IF v_invite.accepted_at IS NOT NULL THEN
      RAISE EXCEPTION 'This invitation was already used';
    END IF;
    IF v_invite.expires_at <= now() THEN
      RAISE EXCEPTION 'This invitation has expired';
    END IF;
    IF lower(v_invite.email) <> v_email THEN
      RAISE EXCEPTION 'This invitation is for %', v_invite.email;
    END IF;
    v_org := v_invite.organization_id;
    v_role := v_invite.role;
    UPDATE public.invitations SET accepted_at = now() WHERE id = v_invite.id;
  ELSE
    SELECT id INTO v_org FROM public.organizations WHERE upper(invite_code) = v_code LIMIT 1;
    IF v_org IS NULL THEN
      RAISE EXCEPTION 'Invalid invite code';
    END IF;
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_org, v_uid, v_role)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  RETURN v_org;
END;
$$;

GRANT EXECUTE ON FUNCTION public.my_pending_invites() TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_org_by_code(text) TO authenticated;