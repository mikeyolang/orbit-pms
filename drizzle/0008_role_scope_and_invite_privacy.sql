DROP POLICY IF EXISTS "Anyone can lookup by token" ON public.invitations;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_custom_role_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.custom_role_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.custom_roles r
    WHERE r.id=NEW.custom_role_id AND r.organization_id=NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'Custom role must belong to the same organization';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_member_custom_role_scope ON public.organization_members;
--> statement-breakpoint
CREATE TRIGGER trg_member_custom_role_scope BEFORE INSERT OR UPDATE OF custom_role_id, organization_id ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.validate_custom_role_scope();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_invitation_custom_role_scope ON public.invitations;
--> statement-breakpoint
CREATE TRIGGER trg_invitation_custom_role_scope BEFORE INSERT OR UPDATE OF custom_role_id, organization_id ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.validate_custom_role_scope();
