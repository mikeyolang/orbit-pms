ALTER FUNCTION public.handle_new_project() SET search_path = public;
ALTER FUNCTION public.assign_task_number() SET search_path = public;
ALTER FUNCTION public.task_completion_stamp() SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_access_project(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_manage_project(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_org_role(uuid, uuid, org_role[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_org_role(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_project(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_project(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, uuid, org_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_role(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) TO authenticated;