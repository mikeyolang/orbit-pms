CREATE OR REPLACE FUNCTION public.broadcast_task_chat_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM pg_notify('task_chat_changed',OLD.task_id::text);
    RETURN OLD;
  END IF;
  PERFORM pg_notify('task_chat_changed',NEW.task_id::text);
  IF TG_OP='UPDATE' AND OLD.task_id IS DISTINCT FROM NEW.task_id THEN
    PERFORM pg_notify('task_chat_changed',OLD.task_id::text);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER broadcast_task_chat AFTER INSERT OR UPDATE OR DELETE ON public.task_comments
FOR EACH ROW EXECUTE FUNCTION public.broadcast_task_chat_change();
--> statement-breakpoint
CREATE TRIGGER broadcast_task_activity AFTER INSERT OR UPDATE OR DELETE ON public.task_activity
FOR EACH ROW EXECUTE FUNCTION public.broadcast_task_chat_change();
