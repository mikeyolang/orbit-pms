
-- =====================================================
-- SHIFT MODULE
-- =====================================================

-- Extend org member with support-only flag
ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS is_support_only boolean NOT NULL DEFAULT false;

-- Enums
DO $$ BEGIN
  CREATE TYPE public.shift_status AS ENUM ('scheduled','in_progress','ended','missed','swapped','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.swap_kind AS ENUM ('direct','open','coverage');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.swap_status AS ENUM ('pending','accepted','declined','approved','cancelled','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================
-- shift_settings
-- =========================================
CREATE TABLE IF NOT EXISTS public.shift_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  auto_copy_enabled boolean NOT NULL DEFAULT true,
  manager_approval_required boolean NOT NULL DEFAULT false,
  allow_half_shifts boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_settings TO authenticated;
GRANT ALL ON public.shift_settings TO service_role;
ALTER TABLE public.shift_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view shift settings" ON public.shift_settings FOR SELECT
  TO authenticated USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "managers manage shift settings" ON public.shift_settings FOR ALL
  TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]))
  WITH CHECK (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]));

CREATE TRIGGER trg_shift_settings_updated
  BEFORE UPDATE ON public.shift_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- shift_types
-- =========================================
CREATE TABLE IF NOT EXISTS public.shift_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  start_time time NOT NULL DEFAULT '09:00',
  end_time time NOT NULL DEFAULT '17:00',
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_types TO authenticated;
GRANT ALL ON public.shift_types TO service_role;
ALTER TABLE public.shift_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view shift types" ON public.shift_types FOR SELECT
  TO authenticated USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "managers manage shift types" ON public.shift_types FOR ALL
  TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]))
  WITH CHECK (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]));

CREATE TRIGGER trg_shift_types_updated
  BEFORE UPDATE ON public.shift_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- shifts
-- =========================================
CREATE TABLE IF NOT EXISTS public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shift_type_id uuid REFERENCES public.shift_types(id) ON DELETE SET NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status public.shift_status NOT NULL DEFAULT 'scheduled',
  started_at timestamptz,
  ended_at timestamptz,
  end_comment text,
  notes text,
  series_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shifts_org_start ON public.shifts(organization_id, start_at);
CREATE INDEX IF NOT EXISTS idx_shifts_user_start ON public.shifts(user_id, start_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shifts TO authenticated;
GRANT ALL ON public.shifts TO service_role;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view shifts" ON public.shifts FOR SELECT
  TO authenticated USING (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY "managers insert shifts" ON public.shifts FOR INSERT
  TO authenticated
  WITH CHECK (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]));

CREATE POLICY "managers update any shift" ON public.shifts FOR UPDATE
  TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]))
  WITH CHECK (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]));

CREATE POLICY "assignee ends own shift" ON public.shifts FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "managers delete shifts" ON public.shifts FOR DELETE
  TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]));

CREATE TRIGGER trg_shifts_updated
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- shift_series
-- =========================================
CREATE TABLE IF NOT EXISTS public.shift_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shift_type_id uuid REFERENCES public.shift_types(id) ON DELETE SET NULL,
  pattern jsonb NOT NULL DEFAULT '{}'::jsonb,
  start_date date NOT NULL,
  end_date date,
  repeat_monthly boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_series TO authenticated;
GRANT ALL ON public.shift_series TO service_role;
ALTER TABLE public.shift_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view series" ON public.shift_series FOR SELECT
  TO authenticated USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "managers manage series" ON public.shift_series FOR ALL
  TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]))
  WITH CHECK (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]));

CREATE TRIGGER trg_shift_series_updated
  BEFORE UPDATE ON public.shift_series
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- shift_swap_requests
-- =========================================
CREATE TABLE IF NOT EXISTS public.shift_swap_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  to_shift_id uuid REFERENCES public.shifts(id) ON DELETE SET NULL,
  kind public.swap_kind NOT NULL DEFAULT 'direct',
  reason text,
  status public.swap_status NOT NULL DEFAULT 'pending',
  expires_at timestamptz,
  manager_note text,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_swap_org_status ON public.shift_swap_requests(organization_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_swap_requests TO authenticated;
GRANT ALL ON public.shift_swap_requests TO service_role;
ALTER TABLE public.shift_swap_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view swaps" ON public.shift_swap_requests FOR SELECT
  TO authenticated USING (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY "requester creates swap" ON public.shift_swap_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    from_user_id = auth.uid()
    AND public.is_org_member(organization_id, auth.uid())
  );

CREATE POLICY "requester cancels own swap" ON public.shift_swap_requests FOR UPDATE
  TO authenticated
  USING (from_user_id = auth.uid())
  WITH CHECK (from_user_id = auth.uid());

CREATE POLICY "target user responds to swap" ON public.shift_swap_requests FOR UPDATE
  TO authenticated
  USING (
    (to_user_id = auth.uid())
    OR (kind = 'open' AND public.is_org_member(organization_id, auth.uid()))
  )
  WITH CHECK (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY "managers manage swaps" ON public.shift_swap_requests FOR ALL
  TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]))
  WITH CHECK (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin','manager']::org_role[]));

CREATE TRIGGER trg_swap_updated
  BEFORE UPDATE ON public.shift_swap_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- Seed defaults on new organization
-- =========================================
CREATE OR REPLACE FUNCTION public.seed_shift_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.shift_settings (organization_id) VALUES (NEW.id)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO public.shift_types (organization_id, key, label, color, start_time, end_time, sort_order) VALUES
    (NEW.id, 'day',   'Day Shift',   '#3b82f6', '08:00', '16:00', 0),
    (NEW.id, 'night', 'Night Shift', '#6366f1', '20:00', '04:00', 1),
    (NEW.id, 'half',  'Half Shift',  '#f59e0b', '12:00', '16:00', 2)
  ON CONFLICT (organization_id, key) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seed_shift_defaults ON public.organizations;
CREATE TRIGGER trg_seed_shift_defaults
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.seed_shift_defaults();

-- Backfill defaults for existing orgs
INSERT INTO public.shift_settings (organization_id)
SELECT o.id FROM public.organizations o
LEFT JOIN public.shift_settings s ON s.organization_id = o.id
WHERE s.id IS NULL;

INSERT INTO public.shift_types (organization_id, key, label, color, start_time, end_time, sort_order)
SELECT o.id, x.key, x.label, x.color, x.start_time::time, x.end_time::time, x.sort_order
FROM public.organizations o
CROSS JOIN (VALUES
  ('day',   'Day Shift',   '#3b82f6', '08:00', '16:00', 0),
  ('night', 'Night Shift', '#6366f1', '20:00', '04:00', 1),
  ('half',  'Half Shift',  '#f59e0b', '12:00', '16:00', 2)
) x(key, label, color, start_time, end_time, sort_order)
ON CONFLICT (organization_id, key) DO NOTHING;

-- =========================================
-- apply_shift_swap
-- =========================================
CREATE OR REPLACE FUNCTION public.apply_shift_swap(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.shift_swap_requests%ROWTYPE;
  actor uuid := auth.uid();
  is_manager boolean;
BEGIN
  SELECT * INTO r FROM public.shift_swap_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swap not found'; END IF;
  IF r.status NOT IN ('pending','approved') THEN
    RAISE EXCEPTION 'Swap is not in an applyable state (%)', r.status;
  END IF;

  is_manager := public.has_org_role(r.organization_id, actor, ARRAY['owner','admin','manager']::org_role[]);

  -- Authorization: target user, open-swap claimant, or manager
  IF NOT (
    is_manager
    OR (r.kind = 'direct' AND r.to_user_id = actor)
    OR (r.kind = 'open' AND public.is_org_member(r.organization_id, actor))
    OR (r.kind = 'coverage' AND is_manager)
  ) THEN
    RAISE EXCEPTION 'Not authorized to apply this swap';
  END IF;

  -- For open swaps, whoever accepts becomes to_user_id
  IF r.to_user_id IS NULL THEN
    UPDATE public.shift_swap_requests SET to_user_id = actor WHERE id = _request_id;
    r.to_user_id := actor;
  END IF;

  -- Reassign shift(s)
  UPDATE public.shifts SET user_id = r.to_user_id WHERE id = r.from_shift_id;
  IF r.to_shift_id IS NOT NULL THEN
    UPDATE public.shifts SET user_id = r.from_user_id WHERE id = r.to_shift_id;
  END IF;

  UPDATE public.shift_swap_requests
     SET status = 'accepted',
         decided_by = actor,
         decided_at = now()
   WHERE id = _request_id;
END $$;

GRANT EXECUTE ON FUNCTION public.apply_shift_swap(uuid) TO authenticated;
