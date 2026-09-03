ALTER TABLE public.shift_swap_requests ADD COLUMN IF NOT EXISTS action_token uuid DEFAULT gen_random_uuid() NOT NULL;
--> statement-breakpoint
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS declined_at timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS shift_swap_requests_action_token_unique ON public.shift_swap_requests(action_token);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.system_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  href text,
  dedupe_key text NOT NULL,
  read_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS system_notifications_dedupe_unique ON public.system_notifications(user_id, dedupe_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS system_notifications_user_created_idx ON public.system_notifications(user_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE public.system_notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, UPDATE ON public.system_notifications TO authenticated;
--> statement-breakpoint
CREATE POLICY "users read own system notifications" ON public.system_notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "users update own system notifications" ON public.system_notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.my_pending_invites();
--> statement-breakpoint
CREATE FUNCTION public.my_pending_invites() RETURNS TABLE (id uuid, organization_id uuid, organization_name text, role public.org_role, token text, expires_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT i.id,i.organization_id,o.name,i.role,i.token,i.expires_at FROM invitations i JOIN organizations o ON o.id=i.organization_id WHERE lower(i.email)=lower(coalesce(auth.jwt()->>'email','')) AND i.accepted_at IS NULL AND i.declined_at IS NULL AND i.expires_at>now() AND NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.organization_id=i.organization_id AND m.user_id=auth.uid())
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.my_pending_invites() TO authenticated;
