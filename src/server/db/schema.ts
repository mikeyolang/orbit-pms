import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const orgRole = pgEnum("org_role", ["owner", "admin", "manager", "member", "viewer"]);

// Better Auth tables use UUIDs so existing Supabase user IDs can be retained.
export const user = pgTable(
  "user",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("user_email_unique").on(table.email)],
);

export const session = pgTable(
  "session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("session_token_unique").on(table.token),
    index("session_user_idx").on(table.userId),
  ],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    issuer: text("issuer").default("local:credential").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("account_user_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    inviteCode: text("invite_code"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("organizations_slug_unique").on(table.slug)],
);

export const customRoles = pgTable(
  "custom_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    baseRole: orgRole("base_role").default("member").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("custom_roles_organization_name_unique").on(table.organizationId, table.name)],
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: orgRole("role").default("member").notNull(),
    customRoleId: uuid("custom_role_id").references(() => customRoles.id, { onDelete: "set null" }),
    isSupportOnly: boolean("is_support_only").default(false).notNull(),
    canAccessProjects: boolean("can_access_projects").default(true).notNull(),
    canAccessShifts: boolean("can_access_shifts").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_members_org_user_unique").on(table.organizationId, table.userId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: uuid("team_id"), // Composite team/workspace foreign key is maintained by the SQL migration.
    email: text("email").notNull(),
    role: orgRole("role").default("member").notNull(),
    token: text("token").notNull(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => user.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("invitations_token_unique").on(table.token)],
);

export const mailOutbox = pgTable(
  "mail_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    textBody: text("text_body").notNull(),
    htmlBody: text("html_body"),
    metadata: jsonb("metadata").$type<Record<string, string>>().default({}).notNull(),
    status: text("status").default("pending").notNull(),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [index("mail_outbox_status_idx").on(table.status, table.createdAt)],
);

export const mailEvents = pgTable("mail_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerEventId: text("provider_event_id").notNull(),
  event: text("event").notNull(),
  recipient: text("recipient"),
  providerMessageId: text("provider_message_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("mail_events_provider_event_unique").on(table.providerEventId)]);

export const mailSuppressions = pgTable("mail_suppressions", {
  recipient: text("recipient").primaryKey(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("audit_events_user_created_idx").on(table.userId, table.createdAt)]);

export const systemNotifications = pgTable("system_notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  href: text("href"),
  dedupeKey: text("dedupe_key").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("system_notifications_dedupe_unique").on(table.userId, table.dedupeKey),
  index("system_notifications_user_created_idx").on(table.userId, table.createdAt),
]);
