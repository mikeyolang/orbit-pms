-- Allow members of the same workspace to see teammate display names/emails for dashboards and team views.

DO $$
BEGIN
  -- This policy is applied through the Supabase migration pipeline; if it already exists, skip it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Org members can view teammate profiles'
  ) THEN
    CREATE POLICY "Org members can view teammate profiles"
      ON public.profiles
      FOR SELECT
      TO authenticated
      USING (
        auth.uid() = id
        OR EXISTS (
          SELECT 1
          FROM public.organization_members mine
          JOIN public.organization_members teammate
            ON teammate.organization_id = mine.organization_id
          WHERE mine.user_id = auth.uid()
            AND teammate.user_id = profiles.id
        )
      );
  END IF;
END $$;
