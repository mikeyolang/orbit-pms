ALTER TABLE public.task_comments ADD COLUMN mentions jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_task_mentions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE mention jsonb; project uuid; mention_start integer; mention_end integer; previous_end integer := 0;
BEGIN
  IF jsonb_typeof(NEW.mentions)<>'array' OR jsonb_array_length(NEW.mentions)>100 THEN
    RAISE EXCEPTION 'A message can contain up to 100 mentions';
  END IF;
  SELECT project_id INTO project FROM tasks WHERE id=NEW.task_id;
  FOR mention IN SELECT value FROM jsonb_array_elements(NEW.mentions) LOOP
    mention_start := (mention->>'start')::integer;
    mention_end := (mention->>'end')::integer;
    IF mention_start IS NULL OR mention_end IS NULL OR mention_start<previous_end OR mention_end<=mention_start
       OR mention_end>length(NEW.body) OR mention->>'label' IS NULL
       OR left(mention->>'label',1)<>'@'
       OR substring(NEW.body FROM mention_start+1 FOR mention_end-mention_start) IS DISTINCT FROM mention->>'label' THEN
      RAISE EXCEPTION 'The message mentions are invalid. Please select the person again.';
    END IF;
    IF mention->>'user_id'='everyone' THEN
      IF mention->>'label'<>'@everyone' THEN RAISE EXCEPTION 'Invalid everyone mention'; END IF;
    ELSIF mention->>'user_id' IS NULL OR NOT public.can_access_project(project,(mention->>'user_id')::uuid) THEN
      RAISE EXCEPTION 'A mentioned person no longer has access to this task. Remove their mention and try again.';
    END IF;
    previous_end := mention_end;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_task_mentions() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER validate_task_chat_mentions BEFORE INSERT OR UPDATE OF body,mentions,task_id ON public.task_comments
FOR EACH ROW EXECUTE FUNCTION public.validate_task_mentions();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notify_task_chat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE task_row record; author_name text;
BEGIN
  SELECT t.*,p.key,p.organization_id INTO task_row FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=NEW.task_id;
  SELECT COALESCE(NULLIF(name,''),email,'A teammate') INTO author_name FROM "user" WHERE id=NEW.author_id;
  WITH mentioned AS (
    SELECT m.user_id FROM organization_members m
    WHERE m.organization_id=task_row.organization_id AND (
      EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.mentions) mention WHERE mention->>'user_id'='everyone')
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.mentions) mention WHERE mention->>'user_id'=m.user_id::text)
    )
  ), participants AS (
    SELECT task_row.assignee_id AS user_id UNION SELECT task_row.reporter_id UNION SELECT task_row.created_by
    UNION SELECT author_id FROM task_comments WHERE task_id=NEW.task_id
    UNION SELECT user_id FROM mentioned
  )
  INSERT INTO system_notifications(user_id,kind,title,body,href,dedupe_key)
  SELECT participant.user_id,
    CASE WHEN tagged.user_id IS NOT NULL THEN 'task-mention' ELSE 'task-chat' END,
    CASE WHEN tagged.user_id IS NOT NULL THEN 'You were mentioned: ' ELSE 'New message: ' END||task_row.key||'-'||task_row.number,
    author_name||': '||left(NEW.body,240),
    '/app/projects/'||task_row.key||'?task='||NEW.task_id||'&tab=chat','task-chat:'||NEW.id
  FROM participants participant LEFT JOIN mentioned tagged ON tagged.user_id=participant.user_id
  WHERE participant.user_id IS NOT NULL AND participant.user_id<>NEW.author_id
    AND public.can_access_project(task_row.project_id,participant.user_id)
  ON CONFLICT(user_id,dedupe_key) DO NOTHING;
  INSERT INTO task_activity(task_id,actor_id,action,payload) VALUES(NEW.task_id,NEW.author_id,'commented','{}');
  RETURN NEW;
END $$;
