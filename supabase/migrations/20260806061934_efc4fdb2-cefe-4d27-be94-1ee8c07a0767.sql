CREATE OR REPLACE FUNCTION public.shares_org_with(_other uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members a
    JOIN public.organization_members b ON b.organization_id = a.organization_id
    WHERE a.user_id = _user AND b.user_id = _other
  )
$$;

DROP POLICY IF EXISTS "Members view profiles in shared orgs" ON public.profiles;
CREATE POLICY "Members view profiles in shared orgs"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id OR public.shares_org_with(id, auth.uid()));