import { createHash, randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../../../../packages/database/src/client.js'
import { syncMutationReceipt, workspace, workspaceMembership } from '../../../../../packages/database/src/schema.js'
import {
  workspaceActivationSchema,
  workspaceSchema,
  type ActivateWorkspaceMutation,
  type CreateWorkspaceMutation,
  type Workspace,
} from '../../../../../packages/workspaces/src/contract.js'
import type { WorkspaceCursor } from '../application/workspace-cursor.js'
import { mutationReceiptExpiry } from '../../maintenance/sync-receipt-retention.js'

const pageSize = 50
export const maxOutstandingMutationReceiptsPerUser = 10_000

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type MutationKind = 'workspace.create' | 'workspace.activate'

class MutationConflictError extends Error {}

function hashPayload(payload: Record<string, string>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

async function reserveMutation(
  transaction: Transaction,
  input: {
    userId: string
    mutationId: string
    kind: MutationKind
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

const workspaceSelection = {
  id: workspace.id,
  name: workspace.name,
  accentColor: workspace.accentColor,
  icon: workspace.icon,
  version: workspace.version,
  lastAccessedAt: workspaceMembership.lastAccessedAt,
  membershipVersion: workspaceMembership.version,
}

function parseWorkspace(row: {
  id: string
  name: string
  accentColor: string
  icon: string
  version: number
  lastAccessedAt: Date | null
  membershipVersion: number
}): Workspace {
  return workspaceSchema.parse({
    ...row,
    lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
  })
}

async function findWorkspaceForUser(transaction: Transaction, userId: string, workspaceId: string) {
  const [row] = await transaction
    .select(workspaceSelection)
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

  return row ? parseWorkspace(row) : null
}

export async function listWorkspacePageForUser(userId: string, cursor: WorkspaceCursor | null) {
  const cursorCondition = cursor
    ? or(
        gt(workspaceMembership.createdAt, cursor.createdAt),
        and(eq(workspaceMembership.createdAt, cursor.createdAt), gt(workspaceMembership.id, cursor.id)),
      )
    : undefined

  const rows = await db
    .select({
      ...workspaceSelection,
      membershipId: workspaceMembership.id,
      membershipCreatedAt: workspaceMembership.createdAt,
    })
    .from(workspaceMembership)
    .innerJoin(workspace, eq(workspace.id, workspaceMembership.workspaceId))
    .where(
      and(
        eq(workspaceMembership.userId, userId),
        isNull(workspaceMembership.deletedAt),
        isNull(workspace.deletedAt),
        cursorCondition,
      ),
    )
    .orderBy(asc(workspaceMembership.createdAt), asc(workspaceMembership.id))
    .limit(pageSize + 1)

  const [lastWorkspace] = await db
    .select({ id: workspace.id })
    .from(workspaceMembership)
    .innerJoin(workspace, eq(workspace.id, workspaceMembership.workspaceId))
    .where(
      and(eq(workspaceMembership.userId, userId), isNull(workspaceMembership.deletedAt), isNull(workspace.deletedAt)),
    )
    .orderBy(sql`${workspaceMembership.lastAccessedAt} DESC NULLS LAST`, desc(workspaceMembership.createdAt))
    .limit(1)

  const hasMore = rows.length > pageSize
  const page = rows.slice(0, pageSize)
  const tail = page.at(-1)

  return {
    workspaces: page.map(parseWorkspace),
    lastWorkspaceId: lastWorkspace?.id ?? null,
    nextCursor: hasMore && tail ? { createdAt: tail.membershipCreatedAt, id: tail.membershipId } : null,
  }
}

export async function createWorkspaceForUser(userId: string, input: CreateWorkspaceMutation) {
  const now = new Date()
  const payloadHash = hashPayload({
    accentColor: input.accentColor,
    icon: input.icon,
    id: input.id,
    name: input.name,
  })

  try {
    return await db.transaction(async (transaction) => {
      const reservation = await reserveMutation(transaction, {
        userId,
        mutationId: input.clientMutationId,
        kind: 'workspace.create',
        entityId: input.id,
        payloadHash,
        now,
      })

      if (reservation === 'conflict') return { kind: 'conflict' as const }
      if (reservation === 'capacity') return { kind: 'capacity' as const }
      if (reservation === 'duplicate') {
        const existing = await findWorkspaceForUser(transaction, userId, input.id)
        if (!existing) throw new MutationConflictError()
        return { kind: 'created' as const, workspace: existing }
      }

      const [created] = await transaction
        .insert(workspace)
        .values({
          id: input.id,
          name: input.name,
          accentColor: input.accentColor,
          icon: input.icon,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: workspace.id })

      if (!created) throw new MutationConflictError()

      await transaction.insert(workspaceMembership).values({
        id: randomUUID(),
        workspaceId: created.id,
        userId,
        role: 'owner',
        lastAccessedAt: now,
        createdAt: now,
        updatedAt: now,
      })

      const result = await findWorkspaceForUser(transaction, userId, created.id)
      if (!result) throw new Error('Created workspace could not be read back.')
      return { kind: 'created' as const, workspace: result }
    })
  } catch (error) {
    if (error instanceof MutationConflictError) return { kind: 'conflict' as const }
    throw error
  }
}

export async function activateWorkspaceForUser(
  userId: string,
  workspaceId: string,
  mutation: ActivateWorkspaceMutation,
) {
  const requestedAt = new Date(mutation.accessedAt)
  const payloadHash = hashPayload({ accessedAt: mutation.accessedAt, workspaceId })

  return db.transaction(async (transaction) => {
    const existing = await findWorkspaceForUser(transaction, userId, workspaceId)
    if (!existing) return { kind: 'not-found' as const }

    const reservation = await reserveMutation(transaction, {
      userId,
      mutationId: mutation.clientMutationId,
      kind: 'workspace.activate',
      entityId: workspaceId,
      payloadHash,
      now: new Date(),
    })

    if (reservation === 'conflict') return { kind: 'conflict' as const }
    if (reservation === 'capacity') return { kind: 'capacity' as const }

    if (reservation === 'new' && (!existing.lastAccessedAt || requestedAt > new Date(existing.lastAccessedAt))) {
      await transaction
        .update(workspaceMembership)
        .set({
          lastAccessedAt: requestedAt,
          updatedAt: new Date(),
          version: sql`${workspaceMembership.version} + 1`,
        })
        .where(
          and(
            eq(workspaceMembership.workspaceId, workspaceId),
            eq(workspaceMembership.userId, userId),
            isNull(workspaceMembership.deletedAt),
          ),
        )
    }

    const activated = await findWorkspaceForUser(transaction, userId, workspaceId)
    if (!activated?.lastAccessedAt) throw new Error('Activated workspace could not be read back.')

    return {
      kind: 'activated' as const,
      activation: workspaceActivationSchema.parse({
        workspaceId,
        lastAccessedAt: activated.lastAccessedAt,
        membershipVersion: activated.membershipVersion,
      }),
    }
  })
}
