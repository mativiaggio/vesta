import { createHash, randomUUID } from 'node:crypto'
import { and, asc, count, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../../../packages/database/src/client.js'
import {
  client,
  syncMutationReceipt,
  workspace,
  workspaceMembership,
} from '../../../../packages/database/src/schema.js'
import {
  clientSchema,
  type CreateClientMutation,
  type DeleteClientMutation,
  type UpdateClientMutation,
  type Client,
  type ClientCursor,
  clientPageSize,
} from '../../../../packages/clients/src/contract.js'
import { mutationReceiptExpiry } from '../maintenance/sync-receipt-retention.js'

const maxOutstandingMutationReceiptsPerUser = 10_000
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type ClientMutationKind = 'client.create' | 'client.update' | 'client.delete'

function hashPayload(payload: Record<string, string | number | boolean>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

async function reserveMutation(
  transaction: Transaction,
  input: {
    userId: string
    mutationId: string
    kind: ClientMutationKind
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

const clientSelection = {
  id: client.id,
  workspaceId: client.workspaceId,
  code: client.code,
  name: client.name,
  active: client.active,
  version: client.version,
  createdAt: client.createdAt,
  updatedAt: client.updatedAt,
  deletedAt: client.deletedAt,
  createdByUserId: client.createdByUserId,
  updatedByUserId: client.updatedByUserId,
  deletedByUserId: client.deletedByUserId,
}

type ClientRow = {
  id: string
  workspaceId: string
  code: string
  name: string
  active: boolean
  version: number
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  createdByUserId: string
  updatedByUserId: string
  deletedByUserId: string | null
}

function parseClient(row: ClientRow): Client {
  return clientSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  })
}

async function findClient(transaction: Transaction, workspaceId: string, clientId: string, includeDeleted = false) {
  const [row] = await transaction
    .select(clientSelection)
    .from(client)
    .where(
      and(
        eq(client.workspaceId, workspaceId),
        eq(client.id, clientId),
        includeDeleted ? undefined : isNull(client.deletedAt),
      ),
    )
    .limit(1)
  return row ? parseClient(row) : null
}

async function listClientPage(
  userId: string,
  workspaceId: string,
  cursor: ClientCursor | null,
  includeSoftDeleted: boolean,
  search = '',
) {
  const cursorCreatedAt = cursor ? new Date(cursor.createdAt) : null
  const cursorCondition =
    cursor && cursorCreatedAt
      ? or(gt(client.createdAt, cursorCreatedAt), and(eq(client.createdAt, cursorCreatedAt), gt(client.id, cursor.id)))
      : undefined

  const searchCondition = search
    ? or(
        sql`strpos(lower(${client.code}), lower(${search})) > 0`,
        sql`strpos(lower(${client.name}), lower(${search})) > 0`,
      )
    : undefined

  return db.transaction(async (transaction) => {
    if (!(await canAccessWorkspace(transaction, userId, workspaceId))) {
      return { kind: 'not-found' as const, clients: [], nextCursor: null }
    }
    const rows = await transaction
      .select(clientSelection)
      .from(client)
      .where(
        and(
          eq(client.workspaceId, workspaceId),
          includeSoftDeleted ? undefined : isNull(client.deletedAt),
          searchCondition,
          cursorCondition,
        ),
      )
      .orderBy(asc(client.createdAt), asc(client.id))
      .limit(clientPageSize + 1)

    const page = rows.slice(0, clientPageSize)
    const tail = page.at(-1)
    return {
      kind: 'listed' as const,
      clients: page.map(parseClient),
      nextCursor:
        rows.length > clientPageSize && tail ? { createdAt: tail.createdAt.toISOString(), id: tail.id } : null,
    }
  })
}

export function listClientsForWorkspace(
  userId: string,
  workspaceId: string,
  cursor: ClientCursor | null,
  search: string,
) {
  return listClientPage(userId, workspaceId, cursor, false, search)
}

export function listClientsForWorkspaceForSync(userId: string, workspaceId: string, cursor: ClientCursor | null) {
  return listClientPage(userId, workspaceId, cursor, true)
}

export async function createClientForWorkspace(userId: string, workspaceId: string, input: CreateClientMutation) {
  const now = new Date()
  const payloadHash = hashPayload({ id: input.id, code: input.code, name: input.name, active: input.active })
  try {
    return await db.transaction(async (transaction) => {
      if (!(await canAccessWorkspace(transaction, userId, workspaceId))) return { kind: 'not-found' as const }
      const reservation = await reserveMutation(transaction, {
        userId,
        mutationId: input.clientMutationId,
        kind: 'client.create',
        entityId: input.id,
        payloadHash,
        now,
      })
      if (reservation === 'conflict') return { kind: 'conflict' as const }
      if (reservation === 'capacity') return { kind: 'capacity' as const }
      if (reservation === 'duplicate') {
        const existing = await findClient(transaction, workspaceId, input.id, true)
        return existing ? { kind: 'created' as const, client: existing } : { kind: 'conflict' as const }
      }
      const [created] = await transaction
        .insert(client)
        .values({
          id: input.id,
          workspaceId,
          code: input.code,
          name: input.name,
          active: input.active,
          version: 1,
          createdByUserId: userId,
          updatedByUserId: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning(clientSelection)
      if (!created) throw new Error('Created client could not be read back.')
      return { kind: 'created' as const, client: parseClient(created) }
    })
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      return { kind: 'conflict' as const }
    }
    throw error
  }
}

export async function updateClientForWorkspace(
  userId: string,
  workspaceId: string,
  clientId: string,
  input: UpdateClientMutation,
) {
  const now = new Date()
  const changes = {
    ...(input.code === undefined ? {} : { code: input.code }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.active === undefined ? {} : { active: input.active }),
  }
  const payloadHash = hashPayload({ ...changes, expectedVersion: input.expectedVersion })
  try {
    return await db.transaction(async (transaction) => {
      if (!(await canAccessWorkspace(transaction, userId, workspaceId))) return { kind: 'not-found' as const }
      const reservation = await reserveMutation(transaction, {
        userId,
        mutationId: input.clientMutationId,
        kind: 'client.update',
        entityId: clientId,
        payloadHash,
        now,
      })
      if (reservation === 'conflict') return { kind: 'conflict' as const }
      if (reservation === 'capacity') return { kind: 'capacity' as const }
      if (reservation === 'duplicate') {
        const existing = await findClient(transaction, workspaceId, clientId)
        return existing ? { kind: 'updated' as const, client: existing } : { kind: 'not-found' as const }
      }
      const existing = await findClient(transaction, workspaceId, clientId)
      if (!existing) return { kind: 'not-found' as const }
      const [updated] = await transaction
        .update(client)
        .set({ ...changes, updatedByUserId: userId, updatedAt: now, version: sql`${client.version} + 1` })
        .where(and(eq(client.id, clientId), eq(client.workspaceId, workspaceId), isNull(client.deletedAt)))
        .returning(clientSelection)
      if (!updated) return { kind: 'not-found' as const }
      return { kind: 'updated' as const, client: parseClient(updated) }
    })
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      return { kind: 'conflict' as const }
    }
    throw error
  }
}

export async function deleteClientForWorkspace(
  userId: string,
  workspaceId: string,
  clientId: string,
  input: DeleteClientMutation,
) {
  const now = new Date()
  const payloadHash = hashPayload({ expectedVersion: input.expectedVersion })
  return db.transaction(async (transaction) => {
    if (!(await canAccessWorkspace(transaction, userId, workspaceId))) return { kind: 'not-found' as const }
    const reservation = await reserveMutation(transaction, {
      userId,
      mutationId: input.clientMutationId,
      kind: 'client.delete',
      entityId: clientId,
      payloadHash,
      now,
    })
    if (reservation === 'conflict') return { kind: 'conflict' as const }
    if (reservation === 'capacity') return { kind: 'capacity' as const }
    const existing = await findClient(transaction, workspaceId, clientId, true)
    if (!existing) return { kind: 'not-found' as const }
    if (reservation === 'duplicate' || existing.deletedAt) {
      return existing.deletedAt
        ? { kind: 'deleted' as const, deletedAt: existing.deletedAt }
        : { kind: 'not-found' as const }
    }
    const [deleted] = await transaction
      .update(client)
      .set({
        deletedAt: now,
        deletedByUserId: userId,
        updatedByUserId: userId,
        updatedAt: now,
        version: sql`${client.version} + 1`,
      })
      .where(and(eq(client.id, clientId), eq(client.workspaceId, workspaceId), isNull(client.deletedAt)))
      .returning({ deletedAt: client.deletedAt })
    if (!deleted?.deletedAt) return { kind: 'conflict' as const }
    return { kind: 'deleted' as const, deletedAt: deleted.deletedAt.toISOString() }
  })
}
