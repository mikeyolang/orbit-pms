CREATE OR REPLACE FUNCTION public.sync_better_auth_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, created_at, updated_at)
  VALUES (NEW.id, NULLIF(NEW.name, ''), NEW.email, COALESCE(NEW.created_at, now()), now())
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), profiles.full_name),
    email = EXCLUDED.email,
    updated_at = now();
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_sync_better_auth_profile ON public."user";
--> statement-breakpoint
CREATE TRIGGER trg_sync_better_auth_profile
  AFTER INSERT OR UPDATE OF name, email ON public."user"
  FOR EACH ROW EXECUTE FUNCTION public.sync_better_auth_profile();
--> statement-breakpoint
INSERT INTO public.profiles (id, full_name, email, created_at, updated_at)
SELECT u.id, NULLIF(u.name, ''), u.email, u.created_at, now()
FROM public."user" u
ON CONFLICT (id) DO UPDATE SET
  full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), profiles.full_name),
  email = EXCLUDED.email,
  updated_at = now();
