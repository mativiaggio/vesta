import { createHash, randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../../../../packages/database/src/client.js'
import {
  client as clientRecord,
  note as noteRecord,
  noteAttachment as noteAttachmentRecord,
  syncMutationReceipt,
  ticketAttachment as ticketAttachmentRecord,
  ticket as ticketRecord,
  workspace,
  workspaceMembership,
} from '../../../../../packages/database/src/schema.js'
import {
  workspaceActivationSchema,
  workspaceSchema,
  type ActivateWorkspaceMutation,
  type CreateWorkspaceMutation,
  type DeleteWorkspaceMutation,
  type UpdateWorkspaceMutation,
  type Workspace,
} from '../../../../../packages/workspaces/src/contract.js'
import type { WorkspaceCursor } from '../application/workspace-cursor.js'
import { mutationReceiptExpiry } from '../../maintenance/sync-receipt-retention.js'

const pageSize = 50
export const maxOutstandingMutationReceiptsPerUser = 10_000

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type MutationKind = 'workspace.create' | 'workspace.update' | 'workspace.activate' | 'workspace.delete'

class MutationConflictError extends Error {}
class WorkspaceNotFoundError extends Error {}

function hashPayload(payload: Record<string, string | number>): string {
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
  const normalizedName = sql<string>`lower(${workspace.name})`
  const cursorName = cursor?.name?.toLowerCase()
  const cursorId = cursor?.id
  const cursorCondition =
    cursorName && cursorId
      ? or(gt(normalizedName, cursorName), and(eq(normalizedName, cursorName), gt(workspace.id, cursorId)))
      : undefined

  const rows = await db
    .select({
      ...workspaceSelection,
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
    .orderBy(asc(normalizedName), asc(workspace.id))
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
    nextCursor: hasMore && tail ? { createdAt: tail.membershipCreatedAt, id: tail.id, name: tail.name } : null,
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

export async function updateWorkspaceForUser(userId: string, workspaceId: string, input: UpdateWorkspaceMutation) {
  // Workspace settings merge by field: independent offline edits coexist, while same-field edits follow commit order.
  const now = new Date()
  const payloadHash = hashPayload({
    ...(input.accentColor === undefined ? {} : { accentColor: input.accentColor }),
    ...(input.icon === undefined ? {} : { icon: input.icon }),
    ...(input.name === undefined ? {} : { name: input.name }),
  })

  try {
    return await db.transaction(async (transaction) => {
      const [membership] = await transaction
        .select({ role: workspaceMembership.role })
        .from(workspaceMembership)
        .where(
          and(
            eq(workspaceMembership.userId, userId),
            eq(workspaceMembership.workspaceId, workspaceId),
            isNull(workspaceMembership.deletedAt),
          ),
        )
        .limit(1)
      if (membership?.role !== 'owner') return { kind: 'not-found' as const }

      const existing = await findWorkspaceForUser(transaction, userId, workspaceId)
      if (!existing) return { kind: 'not-found' as const }

      const reservation = await reserveMutation(transaction, {
        userId,
        mutationId: input.clientMutationId,
        kind: 'workspace.update',
        entityId: workspaceId,
        payloadHash,
        now,
      })

      if (reservation === 'conflict') return { kind: 'conflict' as const }
      if (reservation === 'capacity') return { kind: 'capacity' as const }
      if (reservation === 'duplicate') {
        const current = await findWorkspaceForUser(transaction, userId, workspaceId)
        if (!current) return { kind: 'not-found' as const }
        return { kind: 'updated' as const, workspace: current }
      }

      const [updated] = await transaction
        .update(workspace)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.accentColor === undefined ? {} : { accentColor: input.accentColor }),
          ...(input.icon === undefined ? {} : { icon: input.icon }),
          version: sql`${workspace.version} + 1`,
          updatedAt: now,
        })
        .where(and(eq(workspace.id, workspaceId), isNull(workspace.deletedAt)))
        .returning({ id: workspace.id })

      if (!updated) throw new MutationConflictError()

      const result = await findWorkspaceForUser(transaction, userId, workspaceId)
      if (!result) throw new Error('Updated workspace could not be read back.')
      return { kind: 'updated' as const, workspace: result }
    })
  } catch (error) {
    if (error instanceof MutationConflictError) return { kind: 'conflict' as const }
    throw error
  }
}

export async function deleteWorkspaceForUser(userId: string, workspaceId: string, input: DeleteWorkspaceMutation) {
  const now = new Date()
  const payloadHash = hashPayload({ confirmationName: input.confirmationName })

  try {
    return await db.transaction(async (transaction) => {
      const [membership] = await transaction
        .select({
          role: workspaceMembership.role,
          membershipDeletedAt: workspaceMembership.deletedAt,
          workspaceName: workspace.name,
          workspaceDeletedAt: workspace.deletedAt,
        })
        .from(workspaceMembership)
        .innerJoin(workspace, eq(workspace.id, workspaceMembership.workspaceId))
        .where(and(eq(workspaceMembership.userId, userId), eq(workspaceMembership.workspaceId, workspaceId)))
        .orderBy(sql`${workspaceMembership.deletedAt} ASC NULLS FIRST`)
        .limit(1)

      const activeMembership = membership?.membershipDeletedAt === null && membership.workspaceDeletedAt === null
      const alreadyDeleted = membership?.membershipDeletedAt !== null && membership?.workspaceDeletedAt !== null
      if (membership?.role !== 'owner' || (!activeMembership && !alreadyDeleted)) return { kind: 'not-found' as const }
      if (input.confirmationName !== membership.workspaceName) return { kind: 'invalid' as const }

      const reservation = await reserveMutation(transaction, {
        userId,
        mutationId: input.clientMutationId,
        kind: 'workspace.delete',
        entityId: workspaceId,
        payloadHash,
        now,
      })

      if (reservation === 'conflict') return { kind: 'conflict' as const }
      if (reservation === 'capacity') return { kind: 'capacity' as const }
      if (reservation === 'duplicate' || alreadyDeleted) {
        return {
          kind: 'deleted' as const,
          deletedAt: (membership.workspaceDeletedAt ?? now).toISOString(),
        }
      }

      const [deletedWorkspace] = await transaction
        .update(workspace)
        .set({
          deletedAt: now,
          updatedAt: now,
          version: sql`${workspace.version} + 1`,
        })
        .where(and(eq(workspace.id, workspaceId), isNull(workspace.deletedAt)))
        .returning({ id: workspace.id })

      if (!deletedWorkspace) throw new WorkspaceNotFoundError()

      await transaction
        .update(ticketAttachmentRecord)
        .set({
          deletedAt: now,
          updatedAt: now,
          deletedByUserId: userId,
          updatedByUserId: userId,
          version: sql`${ticketAttachmentRecord.version} + 1`,
        })
        .where(and(eq(ticketAttachmentRecord.workspaceId, workspaceId), isNull(ticketAttachmentRecord.deletedAt)))

      await transaction
        .update(noteAttachmentRecord)
        .set({
          deletedAt: now,
          updatedAt: now,
          deletedByUserId: userId,
          updatedByUserId: userId,
          version: sql`${noteAttachmentRecord.version} + 1`,
        })
        .where(and(eq(noteAttachmentRecord.workspaceId, workspaceId), isNull(noteAttachmentRecord.deletedAt)))

      await transaction
        .update(noteRecord)
        .set({
          deletedAt: now,
          updatedAt: now,
          deletedByUserId: userId,
          updatedByUserId: userId,
          version: sql`${noteRecord.version} + 1`,
        })
        .where(and(eq(noteRecord.workspaceId, workspaceId), isNull(noteRecord.deletedAt)))

      await transaction
        .update(ticketRecord)
        .set({
          deletedAt: now,
          updatedAt: now,
          deletedByUserId: userId,
          updatedByUserId: userId,
          version: sql`${ticketRecord.version} + 1`,
        })
        .where(and(eq(ticketRecord.workspaceId, workspaceId), isNull(ticketRecord.deletedAt)))

      await transaction
        .update(clientRecord)
        .set({
          deletedAt: now,
          updatedAt: now,
          deletedByUserId: userId,
          updatedByUserId: userId,
          version: sql`${clientRecord.version} + 1`,
        })
        .where(and(eq(clientRecord.workspaceId, workspaceId), isNull(clientRecord.deletedAt)))

      await transaction
        .update(workspaceMembership)
        .set({
          deletedAt: now,
          updatedAt: now,
          version: sql`${workspaceMembership.version} + 1`,
        })
        .where(and(eq(workspaceMembership.workspaceId, workspaceId), isNull(workspaceMembership.deletedAt)))

      await transaction
        .update(syncMutationReceipt)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(syncMutationReceipt.entityId, workspaceId),
            inArray(syncMutationReceipt.kind, ['workspace.create', 'workspace.update', 'workspace.activate']),
            isNull(syncMutationReceipt.deletedAt),
          ),
        )

      return { kind: 'deleted' as const, deletedAt: now.toISOString() }
    })
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) return { kind: 'not-found' as const }
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
