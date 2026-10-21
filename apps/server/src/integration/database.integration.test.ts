import { randomUUID } from 'node:crypto'
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '../../../../packages/database/src/client.js'
import {
  client as clientRecord,
  rateLimit,
  syncMutationReceipt,
  user,
  workspace,
  workspaceMembership,
  workspaceMutationRateLimit,
} from '../../../../packages/database/src/schema.js'
import { retentionMaintenanceLockName, runRetentionMaintenance } from '../maintenance/sync-receipt-retention.js'
import { PostgresMutationRateLimiter } from '../rate-limit/postgres-mutation-rate-limiter.js'
import {
  activateWorkspaceForUser,
  createWorkspaceForUser,
  listWorkspacePageForUser,
  maxOutstandingMutationReceiptsPerUser,
} from '../workspaces/data/workspace-repository.js'
import {
  createClientForWorkspace,
  deleteClientForWorkspace,
  listClientsForWorkspace,
  listClientsForWorkspaceForSync,
  updateClientForWorkspace,
} from '../clients/client-repository.js'

const firstUserId = randomUUID()
const secondUserId = randomUUID()
const workspaceId = randomUUID()
const createMutationId = randomUUID()
const activationMutationId = randomUUID()
const clientId = randomUUID()
const secondClientId = randomUUID()
const clientCreateMutationId = randomUUID()
const clientUpdateNameMutationId = randomUUID()
const clientUpdateActiveMutationId = randomUUID()
const clientDeleteMutationId = randomUUID()
const secondClientCreateMutationId = randomUUID()
const limiterScope = `integration:${randomUUID()}`
const authRateLimitKey = `integration-auth:${randomUUID()}`

describe('PostgreSQL workspace persistence', () => {
  beforeAll(async () => {
    await db.insert(user).values([
      { id: firstUserId, name: 'First User', email: `${firstUserId}@example.test` },
      { id: secondUserId, name: 'Second User', email: `${secondUserId}@example.test` },
    ])
  })

  afterAll(async () => {
    await db.delete(syncMutationReceipt).where(inArray(syncMutationReceipt.userId, [firstUserId, secondUserId]))
    await db.delete(clientRecord).where(eq(clientRecord.workspaceId, workspaceId))
    await db.delete(workspaceMembership).where(inArray(workspaceMembership.userId, [firstUserId, secondUserId]))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(workspaceMutationRateLimit).where(sql`${workspaceMutationRateLimit.key} like ${`${limiterScope}%`}`)
    await db.delete(rateLimit).where(eq(rateLimit.key, authRateLimitKey))
    await db.delete(user).where(inArray(user.id, [firstUserId, secondUserId]))
    await pool.end()
  })

  it('creates a workspace atomically and replays an identical mutation idempotently', async () => {
    const input = {
      id: workspaceId,
      clientMutationId: createMutationId,
      name: 'Integration Studio',
      accentColor: 'olive' as const,
      icon: 'briefcase' as const,
    }

    const created = await createWorkspaceForUser(firstUserId, input)
    const replayed = await createWorkspaceForUser(firstUserId, input)
    expect(created).toEqual(replayed)
    expect(created.kind).toBe('created')

    const receipts = await db
      .select({ id: syncMutationReceipt.id })
      .from(syncMutationReceipt)
      .where(and(eq(syncMutationReceipt.userId, firstUserId), eq(syncMutationReceipt.mutationId, createMutationId)))
    expect(receipts).toHaveLength(1)
  })

  it('rejects mutation-id reuse with different content and enforces tenant membership', async () => {
    const conflict = await createWorkspaceForUser(firstUserId, {
      id: workspaceId,
      clientMutationId: createMutationId,
      name: 'Different Studio',
      accentColor: 'blue',
      icon: 'folder',
    })
    expect(conflict.kind).toBe('conflict')

    const otherUserPage = await listWorkspacePageForUser(secondUserId, null)
    expect(otherUserPage.workspaces).toEqual([])
    expect(
      await activateWorkspaceForUser(secondUserId, workspaceId, {
        clientMutationId: randomUUID(),
        accessedAt: new Date().toISOString(),
      }),
    ).toEqual({ kind: 'not-found' })
  })

  it('scopes clients to workspace membership, merges field patches, and retains soft-deleted rows', async () => {
    const input = {
      id: clientId,
      clientMutationId: clientCreateMutationId,
      code: 'CLIENT-001',
      name: 'Client One',
      active: true,
    }
    const firstCreate = await createClientForWorkspace(firstUserId, workspaceId, input)
    const createReplay = await createClientForWorkspace(firstUserId, workspaceId, input)
    expect(firstCreate).toEqual(createReplay)
    expect(firstCreate.kind).toBe('created')
    if (firstCreate.kind !== 'created') throw new Error('Expected the client to be created.')
    expect(firstCreate.client.createdByUserId).toBe(firstUserId)

    const duplicateCode = await createClientForWorkspace(firstUserId, workspaceId, {
      ...input,
      id: secondClientId,
      clientMutationId: secondClientCreateMutationId,
      code: 'client-001',
    })
    expect(duplicateCode.kind).toBe('conflict')

    const nameUpdate = await updateClientForWorkspace(firstUserId, workspaceId, clientId, {
      name: 'Renamed Client',
      expectedVersion: 1,
      clientMutationId: clientUpdateNameMutationId,
    })
    expect(nameUpdate.kind).toBe('updated')
    const activeUpdate = await updateClientForWorkspace(firstUserId, workspaceId, clientId, {
      active: false,
      expectedVersion: 1,
      clientMutationId: clientUpdateActiveMutationId,
    })
    expect(activeUpdate.kind).toBe('updated')
    if (activeUpdate.kind !== 'updated') throw new Error('Expected the client to be updated.')
    expect(activeUpdate.client).toMatchObject({
      name: 'Renamed Client',
      active: false,
      version: 3,
      updatedByUserId: firstUserId,
    })

    const deniedList = await listClientsForWorkspace(secondUserId, workspaceId, null, '')
    expect(deniedList.kind).toBe('not-found')

    const deletion = await deleteClientForWorkspace(firstUserId, workspaceId, clientId, {
      expectedVersion: 1,
      clientMutationId: clientDeleteMutationId,
    })
    expect(deletion.kind).toBe('deleted')
    const activePage = await listClientsForWorkspace(firstUserId, workspaceId, null, '')
    expect(activePage.kind).toBe('listed')
    expect(activePage.clients.some((item) => item.id === clientId)).toBe(false)

    const syncPage = await listClientsForWorkspaceForSync(firstUserId, workspaceId, null)
    expect(syncPage.kind).toBe('listed')
    const deletedClient = syncPage.clients.find((item) => item.id === clientId)
    expect(deletedClient?.deletedByUserId).toBe(firstUserId)
    expect(typeof deletedClient?.deletedAt).toBe('string')
    const persistedRows = await db
      .select({ id: clientRecord.id })
      .from(clientRecord)
      .where(eq(clientRecord.id, clientId))
    expect(persistedRows).toHaveLength(1)

    const reusedCode = await createClientForWorkspace(firstUserId, workspaceId, {
      id: secondClientId,
      clientMutationId: secondClientCreateMutationId,
      code: 'client-001',
      name: 'Replacement Client',
      active: true,
    })
    expect(reusedCode.kind).toBe('created')

    const baseTime = Date.now() + 5_000
    await db.insert(clientRecord).values(
      Array.from({ length: 26 }, (_, index) => {
        const createdAt = new Date(baseTime + index * 1_000)
        return {
          id: randomUUID(),
          workspaceId,
          code: `PAGE-${String(index).padStart(3, '0')}`,
          name: index === 25 ? 'Needle Client' : 'Paged Client',
          active: true,
          version: 1,
          createdByUserId: firstUserId,
          updatedByUserId: firstUserId,
          createdAt,
          updatedAt: createdAt,
        }
      }),
    )

    const firstPage = await listClientsForWorkspace(firstUserId, workspaceId, null, '')
    expect(firstPage.clients).toHaveLength(25)
    expect(firstPage.nextCursor).not.toBeNull()
    const secondPage = await listClientsForWorkspace(firstUserId, workspaceId, firstPage.nextCursor, '')
    expect(secondPage.clients).toHaveLength(2)
    expect(secondPage.nextCursor).toBeNull()

    const filteredPage = await listClientsForWorkspace(firstUserId, workspaceId, null, 'needle')
    expect(filteredPage.clients).toHaveLength(1)
    expect(filteredPage.clients[0]?.name).toBe('Needle Client')
    expect(filteredPage.nextCursor).toBeNull()
  })

  it('replays activation idempotently without incrementing membership twice', async () => {
    const mutation = {
      clientMutationId: activationMutationId,
      accessedAt: new Date(Date.now() + 1000).toISOString(),
    }
    const first = await activateWorkspaceForUser(firstUserId, workspaceId, mutation)
    const replay = await activateWorkspaceForUser(firstUserId, workspaceId, mutation)
    expect(first).toEqual(replay)
    expect(first.kind).toBe('activated')
    if (first.kind === 'activated') expect(first.activation.membershipVersion).toBe(2)
  })

  it('atomically serializes hourly and daily limits across limiter instances', async () => {
    const firstLimiter = new PostgresMutationRateLimiter()
    const secondLimiter = new PostgresMutationRateLimiter()
    const policies = [
      { suffix: 'hour', windowMs: 60_000, max: 5 },
      { suffix: 'day', windowMs: 120_000, max: 8 },
    ] as const
    const decisions = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        (index % 2 === 0 ? firstLimiter : secondLimiter).consume(limiterScope, policies),
      ),
    )
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5)
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(5)

    const rows = await db
      .select({ key: workspaceMutationRateLimit.key, count: workspaceMutationRateLimit.count })
      .from(workspaceMutationRateLimit)
      .where(sql`${workspaceMutationRateLimit.key} like ${`${limiterScope}%`}`)
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.count === 5)).toBe(true)
  })

  it('keeps workspace limits isolated from Better Auth pruning', async () => {
    await db.insert(rateLimit).values({
      id: randomUUID(),
      key: authRateLimitKey,
      count: 1,
      lastRequest: Date.now() - 2 * 60 * 60 * 1000,
    })

    await db.delete(rateLimit).where(eq(rateLimit.key, authRateLimitKey))

    const workspaceLimits = await db
      .select({ count: count() })
      .from(workspaceMutationRateLimit)
      .where(sql`${workspaceMutationRateLimit.key} like ${`${limiterScope}%`}`)
    expect(workspaceLimits[0]?.count).toBe(2)
  })

  it('purges expired maintenance rows in bounded batches and skips a competing replica', async () => {
    const now = new Date()
    const expiredAt = new Date(now.getTime() - 60_000)
    const futureExpiry = new Date(now.getTime() + 60_000)
    const receiptPrefix = `retention-${randomUUID()}`
    const ratePrefix = `retention-rate-${randomUUID()}`

    await db.insert(syncMutationReceipt).values(
      Array.from({ length: 9 }, (_, index) => ({
        id: `${receiptPrefix}-${index}`,
        userId: firstUserId,
        mutationId: `${receiptPrefix}-mutation-${index}`,
        kind: 'workspace.activate',
        entityId: workspaceId,
        payloadHash: 'integration',
        expiresAt: index < 7 ? expiredAt : futureExpiry,
      })),
    )
    await db.insert(workspaceMutationRateLimit).values(
      Array.from({ length: 3 }, (_, index) => ({
        id: `${ratePrefix}-${index}`,
        key: `${ratePrefix}-${index}`,
        count: 1,
        windowStartedAt: expiredAt,
        expiresAt: expiredAt,
      })),
    )

    const firstRun = await runRetentionMaintenance({ now, batchSize: 2, maxBatches: 2 })
    expect(firstRun).toMatchObject({ acquired: true, purgedReceipts: 4, purgedRateLimits: 3, hasMore: true })

    const secondRun = await runRetentionMaintenance({ now, batchSize: 2, maxBatches: 10 })
    expect(secondRun).toMatchObject({ acquired: true, purgedReceipts: 3, hasMore: false })

    const [remaining] = await db
      .select({ count: count() })
      .from(syncMutationReceipt)
      .where(
        and(eq(syncMutationReceipt.userId, firstUserId), sql`${syncMutationReceipt.id} like ${`${receiptPrefix}%`}`),
      )
    expect(remaining?.count).toBe(2)

    await db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${retentionMaintenanceLockName}))`)
      const competingRun = await runRetentionMaintenance({ now })
      expect(competingRun.acquired).toBe(false)
    })
  })

  it('enforces a hard per-user receipt cap without creating domain data', async () => {
    const [usage] = await db
      .select({ count: count() })
      .from(syncMutationReceipt)
      .where(and(eq(syncMutationReceipt.userId, secondUserId), isNull(syncMutationReceipt.deletedAt)))
    const missing = maxOutstandingMutationReceiptsPerUser - (usage?.count ?? 0)

    await db.execute(sql`
      insert into sync_mutation_receipt
        (id, user_id, mutation_id, kind, entity_id, payload_hash, expires_at, created_at, updated_at)
      select
        ${`capacity-${secondUserId}-`} || value::text,
        ${secondUserId},
        ${`capacity-mutation-${secondUserId}-`} || value::text,
        'workspace.activate',
        ${workspaceId},
        'integration',
        now() + interval '30 days',
        now(),
        now()
      from generate_series(1, ${missing}) as series(value)
    `)

    const blockedWorkspaceId = randomUUID()
    const result = await createWorkspaceForUser(secondUserId, {
      id: blockedWorkspaceId,
      clientMutationId: randomUUID(),
      name: 'Must not exist',
      accentColor: 'blue',
      icon: 'folder',
    })
    expect(result).toEqual({ kind: 'capacity' })

    const [created] = await db.select({ id: workspace.id }).from(workspace).where(eq(workspace.id, blockedWorkspaceId))
    expect(created).toBeUndefined()
  })
})
