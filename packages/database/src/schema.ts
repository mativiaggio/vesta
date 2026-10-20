import { sql } from 'drizzle-orm'
import { bigint, boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('user_email_active_unique')
      .on(table.email)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
)

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    ...timestamps,
  },
  (table) => [uniqueIndex('session_token_unique').on(table.token), index('session_user_id_idx').on(table.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    ...timestamps,
  },
  (table) => [
    index('account_user_id_idx').on(table.userId),
    uniqueIndex('account_provider_account_active_unique')
      .on(table.providerId, table.accountId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

export const workspace = pgTable(
  'workspace',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    accentColor: text('accent_color').notNull(),
    icon: text('icon').notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    check(
      'workspace_accent_color_check',
      sql`${table.accentColor} IN ('olive', 'blue', 'terracotta', 'plum', 'teal', 'graphite')`,
    ),
    check(
      'workspace_icon_check',
      sql`${table.icon} IN ('briefcase', 'folder', 'layers', 'notebook-pen', 'laptop', 'palette')`,
    ),
  ],
)

export const workspaceMembership = pgTable(
  'workspace_membership',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    role: text('role').notNull().default('owner'),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    check('workspace_membership_role_check', sql`${table.role} IN ('owner', 'member')`),
    uniqueIndex('workspace_membership_active_unique')
      .on(table.workspaceId, table.userId)
      .where(sql`${table.deletedAt} IS NULL`),
    index('workspace_membership_user_last_accessed_idx')
      .on(table.userId, table.lastAccessedAt)
      .where(sql`${table.deletedAt} IS NULL`),
    index('workspace_membership_user_created_at_idx')
      .on(table.userId, table.createdAt, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
)

export const rateLimit = pgTable(
  'rate_limit',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    count: integer('count').notNull(),
    lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
    ...timestamps,
  },
  (table) => [
    check('rate_limit_count_check', sql`${table.count} >= 0`),
    uniqueIndex('rate_limit_key_active_unique')
      .on(table.key)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
)

export const workspaceMutationRateLimit = pgTable(
  'workspace_mutation_rate_limit',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    count: integer('count').notNull(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    check('workspace_mutation_rate_limit_count_check', sql`${table.count} >= 0`),
    uniqueIndex('workspace_mutation_rate_limit_key_active_unique')
      .on(table.key)
      .where(sql`${table.deletedAt} IS NULL`),
    index('workspace_mutation_rate_limit_expires_at_idx').on(table.expiresAt),
  ],
)

export const syncMutationReceipt = pgTable(
  'sync_mutation_receipt',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    mutationId: text('mutation_id').notNull(),
    kind: text('kind').notNull(),
    entityId: text('entity_id').notNull(),
    payloadHash: text('payload_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    check('sync_mutation_receipt_kind_check', sql`${table.kind} IN ('workspace.create', 'workspace.activate')`),
    uniqueIndex('sync_mutation_receipt_user_mutation_active_unique')
      .on(table.userId, table.mutationId)
      .where(sql`${table.deletedAt} IS NULL`),
    index('sync_mutation_receipt_user_created_at_idx')
      .on(table.userId, table.createdAt)
      .where(sql`${table.deletedAt} IS NULL`),
    index('sync_mutation_receipt_expires_at_idx').on(table.expiresAt),
  ],
)

export const authSchema = {
  user,
  session,
  account,
  verification,
  rateLimit,
  workspaceMutationRateLimit,
  workspace,
  workspaceMembership,
  syncMutationReceipt,
}
