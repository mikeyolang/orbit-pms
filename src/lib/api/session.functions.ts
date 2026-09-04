import { createServerFn } from "@tanstack/react-start";

export const getMyMemberships = createServerFn({ method: "GET" }).handler(async () => {
  const [{ eq }, { requireUser }, { getDb }, schema] = await Promise.all([
    import("drizzle-orm"),
    import("@/server/auth-session.server"),
    import("@/server/db/client.server"),
    import("@/server/db/schema"),
  ]);
  const user = await requireUser();
  const rows = await getDb()
    .select({
      organization_id: schema.organizationMembers.organizationId,
      role: schema.organizationMembers.role,
      custom_role_name: schema.customRoles.name,
      is_support_only: schema.organizationMembers.isSupportOnly,
      can_access_projects: schema.organizationMembers.canAccessProjects,
      can_access_shifts: schema.organizationMembers.canAccessShifts,
      organization: {
        id: schema.organizations.id,
        name: schema.organizations.name,
        slug: schema.organizations.slug,
        invite_code: schema.organizations.inviteCode,
      },
    })
    .from(schema.organizationMembers)
    .innerJoin(
      schema.organizations,
      eq(schema.organizationMembers.organizationId, schema.organizations.id),
    )
    .leftJoin(schema.customRoles, eq(schema.organizationMembers.customRoleId, schema.customRoles.id))
    .where(eq(schema.organizationMembers.userId, user.id));
  return rows;
});
