DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'on_organization_created'
      AND tgrelid = 'public.organizations'::regclass
  ) THEN
    DROP TRIGGER IF EXISTS on_organization_created_add_owner ON public.organizations;
  END IF;
END $$;