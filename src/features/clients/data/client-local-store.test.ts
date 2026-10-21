import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  completeClientMutation,
  enqueueClientCreation,
  enqueueClientDeletion,
  enqueueClientUpdate,
  listPendingClientMutations,
  loadLocalClientPage,
  loadLocalClientState,
  mergeClientSyncPage,
  recordClientMutationFailure,
  resetClientLocalDatabaseForTests,
} from './client-local-store'

const userId = 'user-1'
const workspaceId = '9fcd84af-2f30-4cf8-8c57-ae181b4b4e09'

describe('client local store', () => {
  beforeEach(resetClientLocalDatabaseForTests)
  afterEach(resetClientLocalDatabaseForTests)

  it('commits a client and its pending create mutation durably together', async () => {
    const client = await enqueueClientCreation(userId, workspaceId, {
      code: 'V-001',
      name: 'Example Studio',
      active: true,
    })

    expect(await loadLocalClientState(userId, workspaceId)).toMatchObject({
      clients: [{ id: client.id, code: 'V-001', name: 'Example Studio', active: true, createdByUserId: userId }],
      pendingCount: 1,
      hasLocalData: true,
    })
    expect(await listPendingClientMutations(userId, workspaceId)).toMatchObject([
      { clientId: client.id, kind: 'client.create', state: 'pending' },
    ])
  })

  it('paginates the local replica and applies search before limiting a page', async () => {
    for (let number = 0; number < 27; number += 1) {
      await enqueueClientCreation(userId, workspaceId, {
        code: `V-${String(number).padStart(3, '0')}`,
        name: number === 26 ? 'Target Client' : 'Other Client',
        active: true,
      })
    }

    const firstPage = await loadLocalClientPage(userId, workspaceId, null, '')
    expect(firstPage.clients).toHaveLength(25)
    expect(firstPage.nextCursor).not.toBeNull()
    const secondPage = await loadLocalClientPage(userId, workspaceId, firstPage.nextCursor, '')
    expect(secondPage.clients).toHaveLength(2)
    expect(secondPage.nextCursor).toBeNull()

    const filtered = await loadLocalClientPage(userId, workspaceId, null, 'target')
    expect(filtered.clients).toHaveLength(1)
    expect(filtered.clients[0]?.name).toBe('Target Client')
    expect(filtered.nextCursor).toBeNull()
  })

  it('adds the ordered index when upgrading an existing offline replica', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('vesta-clients', 1)
      request.addEventListener(
        'upgradeneeded',
        () => {
          const database = request.result
          const clients = database.createObjectStore('clients', { keyPath: 'localKey' })
          clients.createIndex('scope', 'scope', { unique: false })
          const mutations = database.createObjectStore('mutations', { keyPath: 'id' })
          mutations.createIndex('scope', ['userId', 'workspaceId'], { unique: false })
        },
        { once: true },
      )
      request.addEventListener(
        'success',
        () => {
          request.result.close()
          resolve()
        },
        { once: true },
      )
      request.addEventListener(
        'error',
        () => reject(request.error ?? new Error('Could not create the legacy client database.')),
        { once: true },
      )
    })

    await expect(loadLocalClientPage(userId, workspaceId, null, '')).resolves.toMatchObject({
      clients: [],
      nextCursor: null,
    })
  })

  it('retains a rejected create locally and coalesces a corrected code into a retry', async () => {
    const client = await enqueueClientCreation(userId, workspaceId, {
      code: 'DUP-1',
      name: 'Example Studio',
      active: true,
    })
    const [createMutation] = await listPendingClientMutations(userId, workspaceId)
    expect(createMutation).toBeDefined()
    if (!createMutation) throw new Error('Expected a create mutation.')
    await recordClientMutationFailure(createMutation, 'Code is already in use.', true)

    await enqueueClientUpdate(userId, workspaceId, client.id, { code: 'DUP-2' })

    const [retryMutation] = await listPendingClientMutations(userId, workspaceId)
    expect(retryMutation).toMatchObject({ kind: 'client.create', payload: { code: 'DUP-2', name: 'Example Studio' } })
    expect(await loadLocalClientState(userId, workspaceId)).toMatchObject({
      clients: [{ id: client.id, code: 'DUP-2' }],
      hasFailedMutations: false,
    })
  })

  it('does not physically remove a locally created record when it is deleted before first sync', async () => {
    const client = await enqueueClientCreation(userId, workspaceId, {
      code: 'V-003',
      name: 'Example Studio',
      active: true,
    })
    await enqueueClientDeletion(userId, workspaceId, client.id)

    expect((await loadLocalClientState(userId, workspaceId)).clients).toEqual([])
    expect(await listPendingClientMutations(userId, workspaceId)).toEqual([])
    const reusedCode = await enqueueClientCreation(userId, workspaceId, {
      code: 'V-003',
      name: 'New Studio',
      active: true,
    })
    expect(reusedCode.code).toBe('V-003')
  })

  it('preserves a local delete that races with a server acknowledgement', async () => {
    const local = await enqueueClientCreation(userId, workspaceId, {
      code: 'V-004',
      name: 'Example Studio',
      active: true,
    })
    const [createMutation] = await listPendingClientMutations(userId, workspaceId)
    if (!createMutation) throw new Error('Expected a create mutation.')
    await enqueueClientDeletion(userId, workspaceId, local.id)

    await completeClientMutation(createMutation, {
      ...local,
      createdByUserId: userId,
      updatedByUserId: userId,
    })

    expect((await loadLocalClientState(userId, workspaceId)).clients).toEqual([])
    expect(await listPendingClientMutations(userId, workspaceId)).toMatchObject([
      { clientId: local.id, kind: 'client.delete', state: 'pending' },
    ])
  })

  it('isolates local replicas by user and workspace', async () => {
    await enqueueClientCreation(userId, workspaceId, { code: 'V-005', name: 'Example Studio', active: true })

    expect((await loadLocalClientState('user-2', workspaceId)).clients).toEqual([])
    expect((await loadLocalClientState(userId, 'a4ec805b-ab95-4a31-8107-e6c805ca11fd')).clients).toEqual([])
  })

  it('applies a server tombstone to the durable replica and excludes it from normal reads', async () => {
    const client = await enqueueClientCreation(userId, workspaceId, {
      code: 'V-006',
      name: 'Example Studio',
      active: true,
    })
    const [mutation] = await listPendingClientMutations(userId, workspaceId)
    if (!mutation) throw new Error('Expected a create mutation.')
    await completeClientMutation(mutation, client)
    await mergeClientSyncPage(userId, workspaceId, {
      clients: [
        {
          ...client,
          version: 2,
          updatedAt: '2026-10-21T12:00:00.000Z',
          deletedAt: '2026-10-21T12:00:00.000Z',
          deletedByUserId: userId,
        },
      ],
    })

    const state = await loadLocalClientState(userId, workspaceId)
    expect(state.clients).toEqual([])
    expect(state.pendingCount).toBe(0)
  })
})
