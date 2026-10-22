import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

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
      sql`${table.accentColor} IN ('olive', 'blue', 'terracotta', 'plum', 'teal', 'graphite', 'sage', 'indigo', 'amber', 'rose', 'sky', 'sand')`,
    ),
    check(
      'workspace_icon_check',
      sql`${table.icon} IN ('briefcase', 'folder', 'layers', 'notebook-pen', 'laptop', 'palette', 'building-2', 'book-open', 'code-2', 'chart-no-axes-combined', 'camera', 'pen-tool')`,
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

export const client = pgTable(
  'client',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id),
    updatedByUserId: text('updated_by_user_id')
      .notNull()
      .references(() => user.id),
    deletedByUserId: text('deleted_by_user_id').references(() => user.id),
    ...timestamps,
  },
  (table) => [
    check('client_code_length_check', sql`length(trim(${table.code})) BETWEEN 1 AND 64`),
    check('client_name_length_check', sql`length(trim(${table.name})) BETWEEN 1 AND 120`),
    check('client_version_check', sql`${table.version} > 0`),
    uniqueIndex('client_workspace_code_active_unique')
      .on(table.workspaceId, sql`lower(${table.code} COLLATE "C")`)
      .where(sql`${table.deletedAt} IS NULL`),
    index('client_workspace_created_active_idx')
      .on(table.workspaceId, table.createdAt, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
    index('client_workspace_updated_idx').on(table.workspaceId, table.updatedAt, table.id),
  ],
)

export const ticket = pgTable(
  'ticket',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id),
    clientId: text('client_id').references(() => client.id),
    otNumber: integer('ot_number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    priority: text('priority').notNull().default('medium'),
    status: text('status').notNull().default('requested'),
    estimatedHours: numeric('estimated_hours', { precision: 8, scale: 2, mode: 'number' }).notNull().default(0),
    workedHours: numeric('worked_hours', { precision: 8, scale: 2, mode: 'number' }).notNull().default(0),
    codingFinishedAt: timestamp('coding_finished_at', { withTimezone: true }),
    productionAt: timestamp('production_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id),
    updatedByUserId: text('updated_by_user_id')
      .notNull()
      .references(() => user.id),
    deletedByUserId: text('deleted_by_user_id').references(() => user.id),
    ...timestamps,
  },
  (table) => [
    check('ticket_title_length_check', sql`length(trim(${table.title})) BETWEEN 1 AND 200`),
    check('ticket_ot_number_check', sql`${table.otNumber} BETWEEN 1 AND 2147483647`),
    check('ticket_description_length_check', sql`length(${table.description}) <= 20000`),
    check('ticket_priority_check', sql`${table.priority} IN ('urgent', 'high', 'medium', 'low')`),
    check(
      'ticket_status_check',
      sql`${table.status} IN ('requested', 'analysis', 'development', 'review', 'correction', 'delivered', 'production')`,
    ),
    check('ticket_estimated_hours_check', sql`${table.estimatedHours} >= 0`),
    check('ticket_worked_hours_check', sql`${table.workedHours} >= 0`),
    check('ticket_version_check', sql`${table.version} > 0`),
    uniqueIndex('ticket_workspace_ot_number_unique').on(table.workspaceId, table.otNumber),
    index('ticket_workspace_created_active_idx')
      .on(table.workspaceId, table.createdAt, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
    index('ticket_workspace_status_active_idx')
      .on(table.workspaceId, table.status, table.createdAt, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
    index('ticket_workspace_priority_active_idx')
      .on(table.workspaceId, table.priority, table.createdAt, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
    index('ticket_workspace_updated_idx').on(table.workspaceId, table.updatedAt, table.id),
  ],
)

export const note = pgTable(
  'note',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => ticket.id),
    title: text('title').notNull(),
    content: jsonb('content').notNull(),
    version: integer('version').notNull().default(1),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id),
    updatedByUserId: text('updated_by_user_id')
      .notNull()
      .references(() => user.id),
    deletedByUserId: text('deleted_by_user_id').references(() => user.id),
    ...timestamps,
  },
  (table) => [
    check('note_title_length_check', sql`length(trim(${table.title})) BETWEEN 1 AND 160`),
    check('note_version_check', sql`${table.version} > 0`),
    index('note_workspace_created_active_idx')
      .on(table.workspaceId, table.createdAt, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
    index('note_ticket_created_active_idx')
      .on(table.ticketId, table.createdAt, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
    index('note_workspace_updated_idx').on(table.workspaceId, table.updatedAt, table.id),
  ],
)

export const ticketAttachment = pgTable(
  'ticket_attachment',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => ticket.id),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    version: integer('version').notNull().default(1),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id),
    updatedByUserId: text('updated_by_user_id')
      .notNull()
      .references(() => user.id),
    deletedByUserId: text('deleted_by_user_id').references(() => user.id),
    ...timestamps,
  },
  (table) => [
    check('ticket_attachment_file_name_length_check', sql`length(trim(${table.fileName})) BETWEEN 1 AND 255`),
    check('ticket_attachment_content_type_length_check', sql`length(trim(${table.contentType})) BETWEEN 1 AND 255`),
    check('ticket_attachment_size_bytes_check', sql`${table.sizeBytes} >= 0`),
    check('ticket_attachment_checksum_check', sql`${table.checksumSha256} ~ '^[a-f0-9]{64}$'`),
    check('ticket_attachment_version_check', sql`${table.version} > 0`),
    uniqueIndex('ticket_attachment_storage_key_unique').on(table.storageKey),
    index('ticket_attachment_ticket_created_active_idx')
      .on(table.ticketId, table.createdAt, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
    index('ticket_attachment_workspace_updated_idx').on(table.workspaceId, table.updatedAt, table.id),
  ],
)

export const noteAttachment = pgTable(
  'note_attachment',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id),
    noteId: text('note_id')
      .notNull()
      .references(() => note.id),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    version: integer('version').notNull().default(1),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id),
    updatedByUserId: text('updated_by_user_id')
      .notNull()
      .references(() => user.id),
    deletedByUserId: text('deleted_by_user_id').references(() => user.id),
    ...timestamps,
  },
  (table) => [
    check('note_attachment_file_name_length_check', sql`length(trim(${table.fileName})) BETWEEN 1 AND 255`),
    check('note_attachment_content_type_length_check', sql`length(trim(${table.contentType})) BETWEEN 1 AND 255`),
    check('note_attachment_size_bytes_check', sql`${table.sizeBytes} >= 0`),
    check('note_attachment_checksum_check', sql`${table.checksumSha256} ~ '^[a-f0-9]{64}$'`),
    check('note_attachment_version_check', sql`${table.version} > 0`),
    uniqueIndex('note_attachment_storage_key_unique').on(table.storageKey),
    index('note_attachment_note_created_active_idx')
      .on(table.noteId, table.createdAt, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
    index('note_attachment_workspace_updated_idx').on(table.workspaceId, table.updatedAt, table.id),
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
    check(
      'sync_mutation_receipt_kind_check',
      sql`${table.kind} IN ('workspace.create', 'workspace.update', 'workspace.activate', 'workspace.delete', 'client.create', 'client.update', 'client.delete', 'ticket.create', 'ticket.update', 'ticket.delete', 'note.create', 'note.update', 'note.delete')`,
    ),
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
  client,
  ticket,
  note,
  ticketAttachment,
  noteAttachment,
  syncMutationReceipt,
}
