CREATE TABLE IF NOT EXISTS public.shift_absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE, absence_type text NOT NULL,
  starts_on date NOT NULL, ends_on date NOT NULL, private_note text, status text NOT NULL DEFAULT 'reported',
  reviewed_by uuid REFERENCES public."user"(id) ON DELETE SET NULL, reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT absence_dates_valid CHECK (ends_on>=starts_on), CONSTRAINT absence_type_valid CHECK (absence_type IN ('sick','annual_leave','emergency_leave','unavailable','other')),
  CONSTRAINT absence_status_valid CHECK (status IN ('reported','approved','rejected','cancelled'))
);
--> statement-breakpoint
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS coverage_status text NOT NULL DEFAULT 'normal';
--> statement-breakpoint
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS absence_id uuid REFERENCES public.shift_absences(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_coverage_status_check;
--> statement-breakpoint
ALTER TABLE public.shifts ADD CONSTRAINT shifts_coverage_status_check CHECK (coverage_status IN ('normal','needed','covered'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.shift_coverage_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  note text, status text NOT NULL DEFAULT 'offered', decided_by uuid REFERENCES public."user"(id) ON DELETE SET NULL,
  decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coverage_offer_status_valid CHECK (status IN ('offered','accepted','declined','withdrawn')), UNIQUE(shift_id,user_id)
);
--> statement-breakpoint
ALTER TABLE public.shift_absences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.shift_coverage_offers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE ON public.shift_absences, public.shift_coverage_offers TO authenticated;
--> statement-breakpoint
CREATE POLICY "private absence access" ON public.shift_absences FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.has_org_role(organization_id,auth.uid(),ARRAY['owner','admin','manager']::public.org_role[]));
--> statement-breakpoint
CREATE POLICY "members report own absence" ON public.shift_absences FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid() AND public.is_org_member(organization_id,auth.uid()));
--> statement-breakpoint
CREATE POLICY "members or managers update absence" ON public.shift_absences FOR UPDATE TO authenticated USING (user_id=auth.uid() OR public.has_org_role(organization_id,auth.uid(),ARRAY['owner','admin','manager']::public.org_role[]));
--> statement-breakpoint
CREATE POLICY "members view coverage offers" ON public.shift_coverage_offers FOR SELECT TO authenticated USING (public.is_org_member(organization_id,auth.uid()));
--> statement-breakpoint
CREATE POLICY "members volunteer" ON public.shift_coverage_offers FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid() AND public.is_org_member(organization_id,auth.uid()) AND EXISTS(SELECT 1 FROM public.shifts s WHERE s.id=shift_id AND s.organization_id=organization_id AND s.user_id<>auth.uid() AND s.coverage_status='needed'));
--> statement-breakpoint
CREATE POLICY "members withdraw or managers decide offers" ON public.shift_coverage_offers FOR UPDATE TO authenticated USING (user_id=auth.uid() OR public.has_org_role(organization_id,auth.uid(),ARRAY['owner','admin','manager']::public.org_role[]));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mark_absence_shifts_for_coverage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.shifts SET coverage_status='needed',absence_id=NEW.id WHERE organization_id=NEW.organization_id AND user_id=NEW.user_id AND status NOT IN ('ended','cancelled') AND start_at::date<=NEW.ends_on AND end_at::date>=NEW.starts_on;
  INSERT INTO public.system_notifications(user_id,kind,title,body,href,dedupe_key)
  SELECT m.user_id,'shift-absence','Shift coverage may be needed','A team member reported an absence.','/app/shifts','absence:'||NEW.id
  FROM public.organization_members m WHERE m.organization_id=NEW.organization_id AND m.role IN ('owner','admin','manager') ON CONFLICT(user_id,dedupe_key) DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_mark_absence_shifts AFTER INSERT ON public.shift_absences FOR EACH ROW EXECUTE FUNCTION public.mark_absence_shifts_for_coverage();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mark_direct_coverage() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN IF OLD.user_id<>NEW.user_id AND OLD.coverage_status='needed' THEN NEW.coverage_status='covered'; END IF; RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER trg_mark_direct_coverage BEFORE UPDATE OF user_id ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.mark_direct_coverage();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.approve_coverage_offer(_offer uuid) RETURNS public.shifts LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_offer public.shift_coverage_offers; v_shift public.shifts;
BEGIN
  SELECT * INTO v_offer FROM public.shift_coverage_offers WHERE id=_offer FOR UPDATE;
  SELECT * INTO v_shift FROM public.shifts WHERE id=v_offer.shift_id FOR UPDATE;
  IF v_offer.id IS NULL OR NOT public.has_org_role(v_offer.organization_id,auth.uid(),ARRAY['owner','admin','manager']::public.org_role[]) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF v_offer.status<>'offered' OR v_shift.coverage_status<>'needed' THEN RAISE EXCEPTION 'Coverage request is no longer active'; END IF;
  IF EXISTS(SELECT 1 FROM public.shifts s WHERE s.user_id=v_offer.user_id AND s.id<>v_shift.id AND s.status NOT IN ('cancelled','ended') AND s.start_at < v_shift.end_at+interval '8 hours' AND s.end_at > v_shift.start_at-interval '8 hours') THEN RAISE EXCEPTION 'Volunteer has an overlapping shift or insufficient rest time'; END IF;
  UPDATE public.shifts SET user_id=v_offer.user_id,coverage_status='covered' WHERE id=v_shift.id RETURNING * INTO v_shift;
  UPDATE public.shift_coverage_offers SET status=CASE WHEN id=_offer THEN 'accepted' ELSE 'declined' END,decided_by=auth.uid(),decided_at=now() WHERE shift_id=v_shift.id AND status='offered';
  INSERT INTO public.system_notifications(user_id,kind,title,body,href,dedupe_key) VALUES(v_offer.user_id,'shift-coverage','Coverage offer accepted','You have been assigned the shift.','/app/shifts','coverage-accepted:'||v_shift.id) ON CONFLICT(user_id,dedupe_key) DO NOTHING;
  RETURN v_shift;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.approve_coverage_offer(uuid) TO authenticated;
