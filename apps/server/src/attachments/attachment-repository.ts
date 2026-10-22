import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../../../packages/database/src/client.js'
import {
  ticket as ticketRecord,
  ticketAttachment as attachmentRecord,
  workspace,
  workspaceMembership,
} from '../../../../packages/database/src/schema.js'
import {
  ticketAttachmentPageSize,
  ticketAttachmentSchema,
  type TicketAttachment,
  type TicketAttachmentCursor,
} from '../../../../packages/tickets/src/attachment-contract.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

type NewAttachment = {
  id: string
  workspaceId: string
  ticketId: string
  userId: string
  fileName: string
  contentType: string
  sizeBytes: number
  checksumSha256: string
  storageKey: string
  now: Date
}

const attachmentSelection = {
  id: attachmentRecord.id,
  workspaceId: attachmentRecord.workspaceId,
  ticketId: attachmentRecord.ticketId,
  fileName: attachmentRecord.fileName,
  contentType: attachmentRecord.contentType,
  sizeBytes: attachmentRecord.sizeBytes,
  checksumSha256: attachmentRecord.checksumSha256,
  version: attachmentRecord.version,
  createdAt: attachmentRecord.createdAt,
  updatedAt: attachmentRecord.updatedAt,
  deletedAt: attachmentRecord.deletedAt,
}

type AttachmentRow = {
  id: string
  workspaceId: string
  ticketId: string
  fileName: string
  contentType: string
  sizeBytes: number
  checksumSha256: string
  version: number
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

function toAttachment(row: AttachmentRow): TicketAttachment {
  return ticketAttachmentSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  })
}

async function canAccessWorkspace(transaction: Transaction, userId: string, workspaceId: string) {
  const [membership] = await transaction
    .select({ id: workspaceMembership.id })
    .from(workspaceMembership)
    .innerJoin(workspace, eq(workspace.id, workspaceMembership.workspaceId))
    .where(
      and(
        eq(workspaceMembership.userId, userId),
        eq(workspaceMembership.workspaceId, workspaceId),
        isNull(workspaceMembership.deletedAt),
        isNull(workspace.deletedAt),
      ),
    )
    .limit(1)
  return Boolean(membership)
}

async function canAccessTicket(transaction: Transaction, workspaceId: string, ticketId: string) {
  const [ticket] = await transaction
    .select({ id: ticketRecord.id })
    .from(ticketRecord)
    .where(
      and(eq(ticketRecord.id, ticketId), eq(ticketRecord.workspaceId, workspaceId), isNull(ticketRecord.deletedAt)),
    )
    .limit(1)
  return Boolean(ticket)
}

export async function authorizeTicketAttachmentUpload(
  userId: string,
  workspaceId: string,
  ticketId: string,
  attachmentId: string,
  fileName: string,
  sizeBytes: number,
) {
  return db.transaction(async (transaction) => {
    if (!(await canAccessWorkspace(transaction, userId, workspaceId))) return { kind: 'not-found' as const }
    if (!(await canAccessTicket(transaction, workspaceId, ticketId))) return { kind: 'not-found' as const }
    const [existing] = await transaction
      .select(attachmentSelection)
      .from(attachmentRecord)
      .where(eq(attachmentRecord.id, attachmentId))
      .limit(1)
    if (!existing) return { kind: 'ready' as const }
    if (
      existing.workspaceId === workspaceId &&
      existing.ticketId === ticketId &&
      existing.fileName === fileName &&
      existing.sizeBytes === sizeBytes &&
      existing.deletedAt === null
    ) {
      return { kind: 'exists' as const, attachment: toAttachment(existing) }
    }
    return { kind: 'conflict' as const }
  })
}

export async function createTicketAttachment(input: NewAttachment) {
  return db.transaction(async (transaction) => {
    if (!(await canAccessWorkspace(transaction, input.userId, input.workspaceId))) return { kind: 'not-found' as const }
    if (!(await canAccessTicket(transaction, input.workspaceId, input.ticketId))) return { kind: 'not-found' as const }
    const [existing] = await transaction
      .select(attachmentSelection)
      .from(attachmentRecord)
      .where(eq(attachmentRecord.id, input.id))
      .limit(1)
    if (existing) {
      if (
        existing.workspaceId === input.workspaceId &&
        existing.ticketId === input.ticketId &&
        existing.fileName === input.fileName &&
        existing.sizeBytes === input.sizeBytes &&
        existing.checksumSha256 === input.checksumSha256 &&
        existing.deletedAt === null
      ) {
        return { kind: 'exists' as const, attachment: toAttachment(existing) }
      }
      return { kind: 'conflict' as const }
    }
    const [created] = await transaction
      .insert(attachmentRecord)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        ticketId: input.ticketId,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        checksumSha256: input.checksumSha256,
        storageKey: input.storageKey,
        createdByUserId: input.userId,
        updatedByUserId: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing({ target: attachmentRecord.id })
      .returning(attachmentSelection)
    if (created) return { kind: 'created' as const, attachment: toAttachment(created) }

    const [existingAfterInsert] = await transaction
      .select(attachmentSelection)
      .from(attachmentRecord)
      .where(eq(attachmentRecord.id, input.id))
      .limit(1)
    if (
      existingAfterInsert &&
      existingAfterInsert.workspaceId === input.workspaceId &&
      existingAfterInsert.ticketId === input.ticketId &&
      existingAfterInsert.fileName === input.fileName &&
      existingAfterInsert.sizeBytes === input.sizeBytes &&
      existingAfterInsert.checksumSha256 === input.checksumSha256 &&
      existingAfterInsert.deletedAt === null
    ) {
      return { kind: 'exists' as const, attachment: toAttachment(existingAfterInsert) }
    }
    return { kind: 'conflict' as const }
  })
}

export async function listTicketAttachments(
  userId: string,
  workspaceId: string,
  ticketId: string,
  cursor: TicketAttachmentCursor | null,
) {
  return db.transaction(async (transaction) => {
    if (!(await canAccessWorkspace(transaction, userId, workspaceId))) {
      return { kind: 'not-found' as const, attachments: [], nextCursor: null }
    }
    if (!(await canAccessTicket(transaction, workspaceId, ticketId))) {
      return { kind: 'not-found' as const, attachments: [], nextCursor: null }
    }
    const cursorCondition = cursor
      ? or(
          gt(attachmentRecord.createdAt, sql`${cursor.createdAt}::timestamptz`),
          and(
            eq(attachmentRecord.createdAt, sql`${cursor.createdAt}::timestamptz`),
            gt(attachmentRecord.id, cursor.id),
          ),
        )
      : undefined
    const rows = await transaction
      .select(attachmentSelection)
      .from(attachmentRecord)
      .where(
        and(
          eq(attachmentRecord.workspaceId, workspaceId),
          eq(attachmentRecord.ticketId, ticketId),
          isNull(attachmentRecord.deletedAt),
          cursorCondition,
        ),
      )
      .orderBy(asc(attachmentRecord.createdAt), asc(attachmentRecord.id))
      .limit(ticketAttachmentPageSize + 1)
    const page = rows.slice(0, ticketAttachmentPageSize)
    const tail = page.at(-1)
    return {
      kind: 'listed' as const,
      attachments: page.map(toAttachment),
      nextCursor:
        rows.length > ticketAttachmentPageSize && tail
          ? { createdAt: tail.createdAt.toISOString(), id: tail.id }
          : null,
    }
  })
}

export async function getTicketAttachment(userId: string, workspaceId: string, ticketId: string, attachmentId: string) {
  return db.transaction(async (transaction) => {
    if (!(await canAccessWorkspace(transaction, userId, workspaceId))) return { kind: 'not-found' as const }
    if (!(await canAccessTicket(transaction, workspaceId, ticketId))) return { kind: 'not-found' as const }
    const [row] = await transaction
      .select({ ...attachmentSelection, storageKey: attachmentRecord.storageKey })
      .from(attachmentRecord)
      .where(
        and(
          eq(attachmentRecord.id, attachmentId),
          eq(attachmentRecord.workspaceId, workspaceId),
          eq(attachmentRecord.ticketId, ticketId),
          isNull(attachmentRecord.deletedAt),
        ),
      )
      .limit(1)
    return row
      ? { kind: 'found' as const, attachment: toAttachment(row), storageKey: row.storageKey }
      : { kind: 'not-found' as const }
  })
}

export async function softDeleteTicketAttachment(
  userId: string,
  workspaceId: string,
  ticketId: string,
  attachmentId: string,
) {
  return db.transaction(async (transaction) => {
    if (!(await canAccessWorkspace(transaction, userId, workspaceId))) return { kind: 'not-found' as const }
    if (!(await canAccessTicket(transaction, workspaceId, ticketId))) return { kind: 'not-found' as const }
    const now = new Date()
    const [deleted] = await transaction
      .update(attachmentRecord)
      .set({
        deletedAt: now,
        deletedByUserId: userId,
        updatedByUserId: userId,
        updatedAt: now,
        version: sql`${attachmentRecord.version} + 1`,
      })
      .where(
        and(
          eq(attachmentRecord.id, attachmentId),
          eq(attachmentRecord.workspaceId, workspaceId),
          eq(attachmentRecord.ticketId, ticketId),
          isNull(attachmentRecord.deletedAt),
        ),
      )
      .returning({ id: attachmentRecord.id, deletedAt: attachmentRecord.deletedAt })
    return deleted ? { kind: 'deleted' as const } : { kind: 'not-found' as const }
  })
}
