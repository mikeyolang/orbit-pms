-- Reuse the existing task conversation history and project visibility rules.
ALTER TABLE public.task_comments ADD CONSTRAINT task_chat_message_length
  CHECK (length(trim(body)) BETWEEN 1 AND 10000) NOT VALID;
--> statement-breakpoint
CREATE POLICY "Task chat requires current project access" ON public.task_comments AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND public.can_access_project(t.project_id,auth.uid())))
  WITH CHECK (EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND public.can_access_project(t.project_id,auth.uid())));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notify_task_chat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE task_row record; author_name text;
BEGIN
  SELECT t.*,p.key INTO task_row FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=NEW.task_id;
  SELECT COALESCE(NULLIF(name,''),email,'A teammate') INTO author_name FROM "user" WHERE id=NEW.author_id;
  INSERT INTO system_notifications(user_id,kind,title,body,href,dedupe_key)
  SELECT participant.user_id,'task-chat','New message: '||task_row.key||'-'||task_row.number,
    author_name||': '||left(NEW.body,240),
    '/app/projects/'||task_row.key||'?task='||NEW.task_id||'&tab=chat','task-chat:'||NEW.id
  FROM (
    SELECT task_row.assignee_id AS user_id UNION SELECT task_row.reporter_id UNION SELECT task_row.created_by
    UNION SELECT author_id FROM task_comments WHERE task_id=NEW.task_id
  ) participant
  WHERE participant.user_id IS NOT NULL AND participant.user_id<>NEW.author_id
    AND public.can_access_project(task_row.project_id,participant.user_id)
  ON CONFLICT(user_id,dedupe_key) DO NOTHING;
  INSERT INTO task_activity(task_id,actor_id,action,payload) VALUES(NEW.task_id,NEW.author_id,'commented','{}');
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notify_task_chat() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER task_chat_notification AFTER INSERT ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.notify_task_chat();
