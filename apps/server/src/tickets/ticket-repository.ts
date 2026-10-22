import { createHash, randomUUID } from 'node:crypto'
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../../../../packages/database/src/client.js'
import {
  client,
  note as noteRecord,
  noteAttachment as noteAttachmentRecord,
  syncMutationReceipt,
  ticket,
  ticketAttachment,
  workspace,
  workspaceMembership,
} from '../../../../packages/database/src/schema.js'
import {
  ticketPageSize,
  ticketSchema,
  type CreateTicketMutation,
  type DeleteTicketMutation,
  type Ticket,
  type TicketCursor,
  type TicketListFilters,
  type UpdateTicketMutation,
} from '../../../../packages/tickets/src/contract.js'
import { mutationReceiptExpiry } from '../maintenance/sync-receipt-retention.js'

const maxOutstandingMutationReceiptsPerUser = 10_000
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type TicketMutationKind = 'ticket.create' | 'ticket.update' | 'ticket.delete'

class TicketVersionConflictError extends Error {}

function hashPayload(payload: Record<string, string | number | boolean | null>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

async function reserveMutation(
  transaction: Transaction,
  input: {
    userId: string
    mutationId: string
    kind: TicketMutationKind
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

const ticketSelection = {
  id: ticket.id,
  workspaceId: ticket.workspaceId,
  otNumber: ticket.otNumber,
  clientId: ticket.clientId,
  title: ticket.title,
  description: ticket.description,
  priority: ticket.priority,
  status: ticket.status,
  estimatedHours: ticket.estimatedHours,
  workedHours: ticket.workedHours,
  codingFinishedAt: ticket.codingFinishedAt,
  productionAt: ticket.productionAt,
  version: ticket.version,
  createdAt: sql<string>`to_char(${ticket.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  updatedAt: ticket.updatedAt,
  deletedAt: ticket.deletedAt,
  createdByUserId: ticket.createdByUserId,
  updatedByUserId: ticket.updatedByUserId,
  deletedByUserId: ticket.deletedByUserId,
  clientName: client.name,
}

type TicketRow = Omit<Ticket, 'updatedAt' | 'deletedAt' | 'codingFinishedAt' | 'productionAt'> & {
  updatedAt: Date
  deletedAt: Date | null
  codingFinishedAt: Date | null
  productionAt: Date | null
}

function parseTicket(row: TicketRow): Ticket {
  return ticketSchema.parse({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    codingFinishedAt: row.codingFinishedAt?.toISOString() ?? null,
    productionAt: row.productionAt?.toISOString() ?? null,
  })
}

async function findTicket(transaction: Transaction, workspaceId: string, ticketId: string, includeDeleted = false) {
  const [row] = await transaction
    .select(ticketSelection)
    .from(ticket)
    .leftJoin(client, and(eq(client.id, ticket.clientId), isNull(client.deletedAt)))
    .where(
      and(
        eq(ticket.workspaceId, workspaceId),
        eq(ticket.id, ticketId),
        includeDeleted ? undefined : isNull(ticket.deletedAt),
      ),
    )
    .limit(1)
  return row ? parseTicket(row as TicketRow) : null
}

async function isValidClient(transaction: Transaction, workspaceId: string, clientId: string | null): Promise<boolean> {
  if (clientId === null) return true
  const [selectedClient] = await transaction
    .select({ id: client.id })
    .from(client)
    .where(
      and(
        eq(client.id, clientId),
        eq(client.workspaceId, workspaceId),
        eq(client.active, true),
        isNull(client.deletedAt),
      ),
    )
    .limit(1)
  return Boolean(selectedClient)
}

async function listTicketPage(
  userId: string,
  workspaceId: string,
  cursor: TicketCursor | null,
  includeSoftDeleted: boolean,
  filters: TicketListFilters,
) {
  const cursorCreatedAt = cursor ? sql`${cursor.createdAt}::timestamptz` : null
  const cursorCondition =
    cursor && cursorCreatedAt
      ? or(lt(ticket.createdAt, cursorCreatedAt), and(eq(ticket.createdAt, cursorCreatedAt), lt(ticket.id, cursor.id)))
      : undefined
  const searchCondition = filters.search
    ? or(
        sql`strpos(lower(${ticket.title}), lower(${filters.search})) > 0`,
        sql`strpos(lower(${ticket.description}), lower(${filters.search})) > 0`,
      )
    : undefined

  return db.transaction(async (transaction) => {
    if (!(await canAccessWorkspace(transaction, userId, workspaceId))) {
      return { kind: 'not-found' as const, tickets: [], nextCursor: null }
    }
    const rows = await transaction
      .select(ticketSelection)
      .from(ticket)
      .leftJoin(client, and(eq(client.id, ticket.clientId), isNull(client.deletedAt)))
      .where(
        and(
          eq(ticket.workspaceId, workspaceId),
          includeSoftDeleted ? undefined : isNull(ticket.deletedAt),
          filters.status ? eq(ticket.status, filters.status) : undefined,
          filters.priority ? eq(ticket.priority, filters.priority) : undefined,
          searchCondition,
          cursorCondition,
        ),
      )
      .orderBy(desc(ticket.createdAt), desc(ticket.id))
      .limit(ticketPageSize + 1)

    const page = rows.slice(0, ticketPageSize)
    const tail = page.at(-1)
    return {
      kind: 'listed' as const,
      tickets: page.map((row) => parseTicket(row as TicketRow)),
      nextCursor: rows.length > ticketPageSize && tail ? { createdAt: tail.createdAt, id: tail.id } : null,
    }
  })
}

export function listTicketsForWorkspace(
  userId: string,
  workspaceId: string,
  cursor: TicketCursor | null,
  filters: TicketListFilters,
) {
  return listTicketPage(userId, workspaceId, cursor, false, filters)
}

export function listTicketsForWorkspaceForSync(userId: string, workspaceId: string, cursor: TicketCursor | null) {
  return listTicketPage(userId, workspaceId, cursor, true, { status: null, priority: null, search: '' })
}

export async function getNextTicketOtNumber(userId: string, workspaceId: string) {
  return db.transaction(async (transaction) => {
    if (!(await canAccessWorkspace(transaction, userId, workspaceId))) return { kind: 'not-found' as const }
    const [result] = await transaction
      .select({ nextNumber: sql<number>`coalesce(max(${ticket.otNumber}), 0) + 1` })
      .from(ticket)
      .where(eq(ticket.workspaceId, workspaceId))
    return { kind: 'found' as const, nextNumber: result?.nextNumber ?? 1 }
  })
}

function isOtNumberConflict(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return false
    if ('code' in current && current.code === '23505') {
      return (
        ('constraint_name' in current && current.constraint_name === 'ticket_workspace_ot_number_unique') ||
        ('constraint' in current && current.constraint === 'ticket_workspace_ot_number_unique')
      )
    }
    current = 'cause' in current ? current.cause : null
  }
  return false
}

export async function createTicketForWorkspace(userId: string, workspaceId: string, input: CreateTicketMutation) {
  const now = new Date()
  const { clientMutationId, ...fields } = input
  const payloadHash = hashPayload(fields)
  try {
    return await db.transaction(async (transaction) => {
      if (!(await canAccessWorkspace(transaction, userId, workspaceId))) return { kind: 'not-found' as const }
      if (!(await isValidClient(transaction, workspaceId, input.clientId))) return { kind: 'invalid-client' as const }
      const reservation = await reserveMutation(transaction, {
        userId,
        mutationId: clientMutationId,
        kind: 'ticket.create',
        entityId: input.id,
        payloadHash,
        now,
      })
      if (reservation === 'conflict') return { kind: 'conflict' as const }
      if (reservation === 'capacity') return { kind: 'capacity' as const }
      if (reservation === 'duplicate') {
        const existing = await findTicket(transaction, workspaceId, input.id, true)
        return existing ? { kind: 'created' as const, ticket: existing } : { kind: 'conflict' as const }
      }
      const [created] = await transaction
        .insert(ticket)
        .values({
          workspaceId,
          ...fields,
          codingFinishedAt: input.status === 'delivered' ? now : null,
          productionAt: input.status === 'production' ? now : null,
          version: 1,
          createdByUserId: userId,
          updatedByUserId: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: ticket.id })
      if (!created) throw new Error('Created ticket could not be read back.')
      const saved = await findTicket(transaction, workspaceId, created.id)
      if (!saved) throw new Error('Created ticket could not be read back.')
      return { kind: 'created' as const, ticket: saved }
    })
  } catch (error) {
    if (isOtNumberConflict(error)) return { kind: 'ot-number-conflict' as const }
    throw error
  }
}

export async function updateTicketForWorkspace(
  userId: string,
  workspaceId: string,
  ticketId: string,
  input: UpdateTicketMutation,
) {
  const now = new Date()
  const changes = {
    ...(input.otNumber === undefined ? {} : { otNumber: input.otNumber }),
    ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.estimatedHours === undefined ? {} : { estimatedHours: input.estimatedHours }),
    ...(input.workedHours === undefined ? {} : { workedHours: input.workedHours }),
  }
  const payloadHash = hashPayload({ ...changes, expectedVersion: input.expectedVersion })
  try {
    return await db.transaction(async (transaction) => {
      if (!(await canAccessWorkspace(transaction, userId, workspaceId))) return { kind: 'not-found' as const }
      if (!(await isValidClient(transaction, workspaceId, input.clientId === undefined ? null : input.clientId))) {
        return { kind: 'invalid-client' as const }
      }
      const reservation = await reserveMutation(transaction, {
        userId,
        mutationId: input.clientMutationId,
        kind: 'ticket.update',
        entityId: ticketId,
        payloadHash,
        now,
      })
      if (reservation === 'conflict') return { kind: 'conflict' as const }
      if (reservation === 'capacity') return { kind: 'capacity' as const }
      if (reservation === 'duplicate') {
        const existing = await findTicket(transaction, workspaceId, ticketId)
        return existing ? { kind: 'updated' as const, ticket: existing } : { kind: 'not-found' as const }
      }
      const milestones = {
        ...(input.status === 'delivered' ? { codingFinishedAt: now } : {}),
        ...(input.status === 'production' ? { productionAt: now } : {}),
      }
      const [updated] = await transaction
        .update(ticket)
        .set({
          ...changes,
          ...milestones,
          updatedByUserId: userId,
          updatedAt: now,
          version: sql`${ticket.version} + 1`,
        })
        .where(
          and(
            eq(ticket.id, ticketId),
            eq(ticket.workspaceId, workspaceId),
            eq(ticket.version, input.expectedVersion),
            isNull(ticket.deletedAt),
          ),
        )
        .returning({ id: ticket.id })
      if (!updated) {
        const existing = await findTicket(transaction, workspaceId, ticketId)
        if (existing) throw new TicketVersionConflictError()
        return { kind: 'not-found' as const }
      }
      const saved = await findTicket(transaction, workspaceId, ticketId)
      if (!saved) throw new Error('Updated ticket could not be read back.')
      return { kind: 'updated' as const, ticket: saved }
    })
  } catch (error) {
    if (error instanceof TicketVersionConflictError) return { kind: 'version-conflict' as const }
    if (isOtNumberConflict(error)) return { kind: 'ot-number-conflict' as const }
    throw error
  }
}

export async function deleteTicketForWorkspace(
  userId: string,
  workspaceId: string,
  ticketId: string,
  input: DeleteTicketMutation,
) {
  const now = new Date()
  const payloadHash = hashPayload({ expectedVersion: input.expectedVersion })
  try {
    return await db.transaction(async (transaction) => {
      if (!(await canAccessWorkspace(transaction, userId, workspaceId))) return { kind: 'not-found' as const }
      const reservation = await reserveMutation(transaction, {
        userId,
        mutationId: input.clientMutationId,
        kind: 'ticket.delete',
        entityId: ticketId,
        payloadHash,
        now,
      })
      if (reservation === 'conflict') return { kind: 'conflict' as const }
      if (reservation === 'capacity') return { kind: 'capacity' as const }
      const existing = await findTicket(transaction, workspaceId, ticketId, true)
      if (!existing) return { kind: 'not-found' as const }
      if (reservation === 'duplicate' || existing.deletedAt) {
        return existing.deletedAt
          ? { kind: 'deleted' as const, deletedAt: existing.deletedAt }
          : { kind: 'not-found' as const }
      }
      const [deleted] = await transaction
        .update(ticket)
        .set({
          deletedAt: now,
          deletedByUserId: userId,
          updatedByUserId: userId,
          updatedAt: now,
          version: sql`${ticket.version} + 1`,
        })
        .where(
          and(
            eq(ticket.id, ticketId),
            eq(ticket.workspaceId, workspaceId),
            eq(ticket.version, input.expectedVersion),
            isNull(ticket.deletedAt),
          ),
        )
        .returning({ deletedAt: ticket.deletedAt })
      if (!deleted?.deletedAt) throw new TicketVersionConflictError()
      await transaction
        .update(ticketAttachment)
        .set({
          deletedAt: now,
          deletedByUserId: userId,
          updatedByUserId: userId,
          updatedAt: now,
          version: sql`${ticketAttachment.version} + 1`,
        })
        .where(
          and(
            eq(ticketAttachment.workspaceId, workspaceId),
            eq(ticketAttachment.ticketId, ticketId),
            isNull(ticketAttachment.deletedAt),
          ),
        )
      await transaction
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
            eq(noteRecord.workspaceId, workspaceId),
            eq(noteRecord.ticketId, ticketId),
            isNull(noteRecord.deletedAt),
          ),
        )
      await transaction
        .update(noteAttachmentRecord)
        .set({
          deletedAt: now,
          deletedByUserId: userId,
          updatedByUserId: userId,
          updatedAt: now,
          version: sql`${noteAttachmentRecord.version} + 1`,
        })
        .where(
          and(
            eq(noteAttachmentRecord.workspaceId, workspaceId),
            inArray(
              noteAttachmentRecord.noteId,
              transaction
                .select({ id: noteRecord.id })
                .from(noteRecord)
                .where(and(eq(noteRecord.workspaceId, workspaceId), eq(noteRecord.ticketId, ticketId))),
            ),
            isNull(noteAttachmentRecord.deletedAt),
          ),
        )
      return { kind: 'deleted' as const, deletedAt: deleted.deletedAt.toISOString() }
    })
  } catch (error) {
    if (error instanceof TicketVersionConflictError) return { kind: 'version-conflict' as const }
    throw error
  }
}

export async function getTicketForWorkspace(userId: string, workspaceId: string, ticketId: string) {
  return db.transaction(async (transaction) => {
    if (!(await canAccessWorkspace(transaction, userId, workspaceId))) return { kind: 'not-found' as const }
    const found = await findTicket(transaction, workspaceId, ticketId)
    return found ? { kind: 'found' as const, ticket: found } : { kind: 'not-found' as const }
  })
}
