DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'on_organization_created_add_owner'
      AND tgrelid = 'public.organizations'::regclass
  ) THEN
    CREATE TRIGGER on_organization_created_add_owner
      AFTER INSERT ON public.organizations
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_new_org();
  END IF;
END $$;

INSERT INTO public.organization_members (organization_id, user_id, role)
SELECT o.id, o.created_by, 'owner'::public.org_role
FROM public.organizations o
WHERE o.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = o.id
      AND om.user_id = o.created_by
  )
ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner';