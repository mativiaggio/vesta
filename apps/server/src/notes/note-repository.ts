import { createHash, randomUUID } from 'node:crypto'
import { and, count, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../../../../packages/database/src/client.js'
import {
  client,
  note as noteRecord,
  noteAttachment,
  syncMutationReceipt,
  ticket,
  workspace,
  workspaceMembership,
} from '../../../../packages/database/src/schema.js'
import {
  notePageSize,
  noteSchema,
  type CreateNoteMutation,
  type DeleteNoteMutation,
  type Note,
  type NoteCursor,
  type NoteListFilters,
  type UpdateNoteMutation,
} from '../../../../packages/notes/src/contract.js'
import { mutationReceiptExpiry } from '../maintenance/sync-receipt-retention.js'

const maxOutstandingMutationReceiptsPerUser = 10_000
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type NoteMutationKind = 'note.create' | 'note.update' | 'note.delete'

class NoteVersionConflictError extends Error {}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

async function reserveMutation(
  transaction: Transaction,
  input: {
    userId: string
    mutationId: string
    kind: NoteMutationKind
    entityId: string
    payloadHash: string
    now: Date
  },
): Promise<'new' | 'duplicate' | 'conflict' | 'capacity'> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`sync-receipt:${input.userId}`}))`)
  const [receipt] = await transaction
    .select({
      kind: syncMutationReceipt.kind,
      entityId: syncMutationReceipt.entityId,
      payloadHash: syncMutationReceipt.payloadHash,
    })
    .from(syncMutationReceipt)
    .where(
      and(
        eq(syncMutationReceipt.userId, input.userId),
        eq(syncMutationReceipt.mutationId, input.mutationId),
        isNull(syncMutationReceipt.deletedAt),
      ),
    )
    .limit(1)
  if (receipt) {
    return receipt.kind === input.kind &&
      receipt.entityId === input.entityId &&
      receipt.payloadHash === input.payloadHash
      ? 'duplicate'
      : 'conflict'
  }

  const [usage] = await transaction
    .select({ count: count() })
    .from(syncMutationReceipt)
    .where(and(eq(syncMutationReceipt.userId, input.userId), isNull(syncMutationReceipt.deletedAt)))
  if ((usage?.count ?? 0) >= maxOutstandingMutationReceiptsPerUser) return 'capacity'

  await transaction.insert(syncMutationReceipt).values({
    id: randomUUID(),
    userId: input.userId,
    mutationId: input.mutationId,
    kind: input.kind,
    entityId: input.entityId,
    payloadHash: input.payloadHash,
    expiresAt: mutationReceiptExpiry(input.now),
    createdAt: input.now,
    updatedAt: input.now,
  })
  return 'new'
}

async function canAccessWorkspace(transaction: Transaction, userId: string, workspaceId: string): Promise<boolean> {
  const [membership] = await transaction
    .select({ workspaceId: workspaceMembership.workspaceId })
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

async function canAccessTicket(transaction: Transaction, workspaceId: string, ticketId: string): Promise<boolean> {
  const [found] = await transaction
    .select({ id: ticket.id })
    .from(ticket)
    .where(and(eq(ticket.id, ticketId), eq(ticket.workspaceId, workspaceId), isNull(ticket.deletedAt)))
    .limit(1)
  return Boolean(found)
}

const noteSelection = {
  id: noteRecord.id,
  workspaceId: noteRecord.workspaceId,
  ticketId: noteRecord.ticketId,
  title: noteRecord.title,
  content: noteRecord.content,
  version: noteRecord.version,
  createdAt: noteRecord.createdAt,
  updatedAt: noteRecord.updatedAt,
  deletedAt: noteRecord.deletedAt,
  createdByUserId: noteRecord.createdByUserId,
  updatedByUserId: noteRecord.updatedByUserId,
  deletedByUserId: noteRecord.deletedByUserId,
  ticket: {
    otNumber: ticket.otNumber,
    title: ticket.title,
    status: ticket.status,
    clientId: ticket.clientId,
    clientName: client.name,
  },
}

type NoteRow = {
  id: string
  workspaceId: string
  ticketId: string
  title: string
  content: unknown
  version: number
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  createdByUserId: string
  updatedByUserId: string
  deletedByUserId: string | null
  ticket: { otNumber: number; title: string; status: string; clientId: string | null; clientName: string | null } | null
}

function parseNote(row: NoteRow): Note {
  return noteSchema.parse({
    ...row,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  })
}

function noteQuery(transaction: Transaction) {
  return transaction
    .select(noteSelection)
    .from(noteRecord)
    .innerJoin(ticket, and(eq(ticket.id, noteRecord.ticketId), eq(ticket.workspaceId, noteRecord.workspaceId)))
    .leftJoin(client, and(eq(client.id, ticket.clientId), isNull(client.deletedAt)))
}

async function findNote(transaction: Transaction, workspaceId: string, noteId: string, includeDeleted = false) {
  const [row] = await noteQuery(transaction)
    .where(
      and(
        eq(noteRecord.workspaceId, workspaceId),
        eq(noteRecord.id, noteId),
        includeDeleted ? undefined : isNull(noteRecord.deletedAt),
        includeDeleted ? undefined : isNull(ticket.deletedAt),
      ),
    )
    .limit(1)
  return row ? parseNote(row) : null
}

async function listNotePage(
  userId: string,
  workspaceId: string,
  cursor: NoteCursor | null,
  includeSoftDeleted: boolean,
  filters: NoteListFilters,
) {
  const cursorCreatedAt = cursor ? sql`${cursor.createdAt}::timestamptz` : null
  const cursorCondition =
    cursor && cursorCreatedAt
      ? or(
          lt(noteRecord.createdAt, cursorCreatedAt),
          and(eq(noteRecord.createdAt, cursorCreatedAt), lt(noteRecord.id, cursor.id)),
        )
      : undefined
  return db.transaction(async (transaction) => {
    if (!(await canAccessWorkspace(transaction, userId, workspaceId))) {
      return { kind: 'not-found' as const, notes: [], nextCursor: null }
    }
    const rows = await noteQuery(transaction)
      .where(
        and(
          eq(noteRecord.workspaceId, workspaceId),
          includeSoftDeleted ? undefined : isNull(noteRecord.deletedAt),
          includeSoftDeleted ? undefined : isNull(ticket.deletedAt),
          filters.ticketId ? eq(noteRecord.ticketId, filters.ticketId) : undefined,
          cursorCondition,
        ),
      )
      .orderBy(desc(noteRecord.createdAt), desc(noteRecord.id))
      .limit(notePageSize + 1)

    const page = rows.slice(0, notePageSize)
    const tail = page.at(-1)
    return {
      kind: 'listed' as const,
      notes: page.map((row) => parseNote(row as NoteRow)),
      nextCursor: rows.length > notePageSize && tail ? { createdAt: tail.createdAt.toISOString(), id: tail.id } : null,
    }
  })
}

export function listNotesForWorkspace(
  userId: string,
  workspaceId: string,
  cursor: NoteCursor | null,
  filters: NoteListFilters,
) {
  return listNotePage(userId, workspaceId, cursor, false, filters)
}

export function listNotesForWorkspaceForSync(userId: string, workspaceId: string, cursor: NoteCursor | null) {
  return listNotePage(userId, workspaceId, cursor, true, { ticketId: null })
}

export async function getNoteForWorkspace(userId: string, workspaceId: string, noteId: string) {
  return db.transaction(async (transaction) => {
    if (!(await canAccessWorkspace(transaction, userId, workspaceId))) return { kind: 'not-found' as const }
    const found = await findNote(transaction, workspaceId, noteId)
    return found ? { kind: 'found' as const, note: found } : { kind: 'not-found' as const }
  })
}

export async function createNoteForWorkspace(userId: string, workspaceId: string, input: CreateNoteMutation) {
  const now = new Date()
  const { clientMutationId, ...fields } = input
  const payloadHash = hashPayload(fields)
  return db.transaction(async (transaction) => {
    if (!(await canAccessWorkspace(transaction, userId, workspaceId))) return { kind: 'not-found' as const }
    if (!(await canAccessTicket(transaction, workspaceId, input.ticketId))) return { kind: 'invalid-ticket' as const }
    const reservation = await reserveMutation(transaction, {
      userId,
      mutationId: clientMutationId,
      kind: 'note.create',
      entityId: input.id,
      payloadHash,
      now,
    })
    if (reservation === 'conflict') return { kind: 'conflict' as const }
    if (reservation === 'capacity') return { kind: 'capacity' as const }
    if (reservation === 'duplicate') {
      const existing = await findNote(transaction, workspaceId, input.id, true)
      return existing ? { kind: 'created' as const, note: existing } : { kind: 'conflict' as const }
    }
    const [created] = await transaction
      .insert(noteRecord)
      .values({
        id: input.id,
        workspaceId,
        ticketId: input.ticketId,
        title: input.title,
        content: input.content,
        version: 1,
        createdByUserId: userId,
        updatedByUserId: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: noteRecord.id })
    if (!created) throw new Error('Created note could not be read back.')
    const saved = await findNote(transaction, workspaceId, created.id)
    if (!saved) throw new Error('Created note could not be read back.')
    return { kind: 'created' as const, note: saved }
  })
}

export async function updateNoteForWorkspace(
  userId: string,
  workspaceId: string,
  noteId: string,
  input: UpdateNoteMutation,
) {
  const now = new Date()
  const changes = {
    ...(input.ticketId === undefined ? {} : { ticketId: input.ticketId }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.content === undefined ? {} : { content: input.content }),
  }
  const payloadHash = hashPayload({ ...changes, expectedVersion: input.expectedVersion })
  try {
    return await db.transaction(async (transaction) => {
      if (!(await canAccessWorkspace(transaction, userId, workspaceId))) return { kind: 'not-found' as const }
      if (input.ticketId !== undefined && !(await canAccessTicket(transaction, workspaceId, input.ticketId))) {
        return { kind: 'invalid-ticket' as const }
      }
      const reservation = await reserveMutation(transaction, {
        userId,
        mutationId: input.clientMutationId,
        kind: 'note.update',
        entityId: noteId,
        payloadHash,
        now,
      })
      if (reservation === 'conflict') return { kind: 'conflict' as const }
      if (reservation === 'capacity') return { kind: 'capacity' as const }
      if (reservation === 'duplicate') {
        const existing = await findNote(transaction, workspaceId, noteId)
        return existing ? { kind: 'updated' as const, note: existing } : { kind: 'not-found' as const }
      }
      const [updated] = await transaction
        .update(noteRecord)
        .set({
          ...changes,
          updatedByUserId: userId,
          updatedAt: now,
          version: sql`${noteRecord.version} + 1`,
        })
        .where(
          and(
            eq(noteRecord.id, noteId),
            eq(noteRecord.workspaceId, workspaceId),
            eq(noteRecord.version, input.expectedVersion),
            isNull(noteRecord.deletedAt),
          ),
        )
        .returning({ id: noteRecord.id })
      if (!updated) {
        const existing = await findNote(transaction, workspaceId, noteId)
        if (existing) throw new NoteVersionConflictError()
        return { kind: 'not-found' as const }
      }
      const saved = await findNote(transaction, workspaceId, noteId)
      if (!saved) throw new Error('Updated note could not be read back.')
      return { kind: 'updated' as const, note: saved }
    })
  } catch (error) {
    if (error instanceof NoteVersionConflictError) return { kind: 'version-conflict' as const }
    throw error
  }
}

export async function deleteNoteForWorkspace(
  userId: string,
  workspaceId: string,
  noteId: string,
  input: DeleteNoteMutation,
) {
  const now = new Date()
  const payloadHash = hashPayload({ expectedVersion: input.expectedVersion })
  try {
    return await db.transaction(async (transaction) => {
      if (!(await canAccessWorkspace(transaction, userId, workspaceId))) return { kind: 'not-found' as const }
      const reservation = await reserveMutation(transaction, {
        userId,
        mutationId: input.clientMutationId,
        kind: 'note.delete',
        entityId: noteId,
        payloadHash,
        now,
      })
      if (reservation === 'conflict') return { kind: 'conflict' as const }
      if (reservation === 'capacity') return { kind: 'capacity' as const }
      const existing = await findNote(transaction, workspaceId, noteId, true)
      if (!existing) return { kind: 'not-found' as const }
      if (reservation === 'duplicate' || existing.deletedAt) {
        return existing.deletedAt
          ? { kind: 'deleted' as const, deletedAt: existing.deletedAt }
          : { kind: 'not-found' as const }
      }
      const [deleted] = await transaction
        .update(noteRecord)
        .set({
          deletedAt: now,
          deletedByUserId: userId,
          updatedByUserId: userId,
          updatedAt: now,
          version: sql`${noteRecord.version} + 1`,
        })
        .where(
          and(
            eq(noteRecord.id, noteId),
            eq(noteRecord.workspaceId, workspaceId),
            eq(noteRecord.version, input.expectedVersion),
            isNull(noteRecord.deletedAt),
          ),
        )
        .returning({ deletedAt: noteRecord.deletedAt })
      if (!deleted?.deletedAt) throw new NoteVersionConflictError()
      await transaction
        .update(noteAttachment)
        .set({
          deletedAt: now,
          deletedByUserId: userId,
          updatedByUserId: userId,
          updatedAt: now,
          version: sql`${noteAttachment.version} + 1`,
        })
        .where(
          and(
            eq(noteAttachment.workspaceId, workspaceId),
            eq(noteAttachment.noteId, noteId),
            isNull(noteAttachment.deletedAt),
          ),
        )
      return { kind: 'deleted' as const, deletedAt: deleted.deletedAt.toISOString() }
    })
  } catch (error) {
    if (error instanceof NoteVersionConflictError) return { kind: 'version-conflict' as const }
    throw error
  }
}
