import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CreateTicketMutation } from '../../../../packages/tickets/src/contract'
import {
  completeTicketMutation,
  enqueueTicketCreation,
  enqueueTicketDeletion,
  enqueueTicketUpdate,
  getNextLocalTicketOtNumber,
  listPendingTicketMutations,
  loadLocalTicketPage,
  markTicketReplicaHydrated,
  mergeTicketSyncPage,
  recordTicketMutationFailure,
  rebasePendingTicketMutations,
  resetTicketLocalDatabaseForTests,
} from './ticket-local-store'

const userId = 'user-1'
const workspaceId = '9fcd84af-2f30-4cf8-8c57-ae181b4b4e09'
const emptyFilters = { status: null, priority: null, search: '' } as const

function ticketInput(number: number): Omit<CreateTicketMutation, 'id' | 'clientMutationId'> {
  return {
    otNumber: number + 1,
    clientId: null,
    title: number === 26 ? 'Target ticket' : 'Other ticket',
    description: number === 26 ? 'Needle in the description' : 'Routine work',
    priority: number === 26 ? 'urgent' : 'medium',
    status: number === 26 ? 'analysis' : 'requested',
    estimatedHours: 3.5,
    workedHours: 0,
  }
}

describe('ticket local store', () => {
  beforeEach(resetTicketLocalDatabaseForTests)
  afterEach(resetTicketLocalDatabaseForTests)

  it('commits a ticket and its pending create mutation durably together', async () => {
    const ticket = await enqueueTicketCreation(userId, workspaceId, ticketInput(0), null)

    expect(await loadLocalTicketPage(userId, workspaceId, null, emptyFilters)).toMatchObject({
      tickets: [{ id: ticket.id, title: 'Other ticket', priority: 'medium', status: 'requested' }],
      pendingCount: 1,
      hasLocalData: true,
    })
    expect(await listPendingTicketMutations(userId, workspaceId)).toMatchObject([
      { ticketId: ticket.id, kind: 'ticket.create', state: 'pending' },
    ])
  })

  it('paginates filtered local rows and applies filters before page limits', async () => {
    for (let number = 0; number < 27; number += 1) {
      await enqueueTicketCreation(userId, workspaceId, ticketInput(number), null)
    }

    const firstPage = await loadLocalTicketPage(userId, workspaceId, null, emptyFilters)
    expect(firstPage.tickets).toHaveLength(25)
    expect(firstPage.tickets[0]?.title).toBe('Target ticket')
    expect(firstPage.nextCursor).not.toBeNull()
    const secondPage = await loadLocalTicketPage(userId, workspaceId, firstPage.nextCursor, emptyFilters)
    expect(secondPage.tickets).toHaveLength(2)
    expect(secondPage.nextCursor).toBeNull()

    const filtered = await loadLocalTicketPage(userId, workspaceId, null, {
      status: 'analysis',
      priority: 'urgent',
      search: 'needle',
    })
    expect(filtered.tickets).toHaveLength(1)
    expect(filtered.tickets[0]?.title).toBe('Target ticket')
    expect(filtered.nextCursor).toBeNull()
  })

  it('persists completion of replica hydration per workspace', async () => {
    expect((await loadLocalTicketPage(userId, workspaceId, null, emptyFilters)).hasCompleteReplica).toBe(false)
    await markTicketReplicaHydrated(userId, workspaceId)
    expect((await loadLocalTicketPage(userId, workspaceId, null, emptyFilters)).hasCompleteReplica).toBe(true)
    expect(
      (await loadLocalTicketPage(userId, 'a20fa617-daa0-4dd4-9c53-ec7a75f86012', null, emptyFilters))
        .hasCompleteReplica,
    ).toBe(false)
  })

  it('keeps soft deleted records in the replica but hides them from active pages', async () => {
    const ticket = await enqueueTicketCreation(userId, workspaceId, ticketInput(0), null)
    await enqueueTicketDeletion(userId, workspaceId, ticket.id)

    expect(await loadLocalTicketPage(userId, workspaceId, null, emptyFilters)).toMatchObject({
      tickets: [],
      pendingCount: 2,
      hasFailedMutations: false,
    })
    expect(await listPendingTicketMutations(userId, workspaceId)).toHaveLength(2)
  })

  it('suggests the next OT number after the maximum, including a soft deleted ticket', async () => {
    const ticket = await enqueueTicketCreation(userId, workspaceId, ticketInput(8), null)
    await enqueueTicketDeletion(userId, workspaceId, ticket.id)

    await expect(getNextLocalTicketOtNumber(userId, workspaceId)).resolves.toBe(10)
    await expect(enqueueTicketCreation(userId, workspaceId, ticketInput(8), null)).rejects.toThrow('ot-number-conflict')
  })

  it('preserves an edited OT number in the local ticket and queued update', async () => {
    const ticket = await enqueueTicketCreation(userId, workspaceId, ticketInput(0), null)
    const [creation] = await listPendingTicketMutations(userId, workspaceId)
    if (!creation || creation.kind !== 'ticket.create') throw new Error('Expected a create mutation.')
    await completeTicketMutation(creation, ticket)
    const updated = await enqueueTicketUpdate(userId, workspaceId, ticket.id, { otNumber: 42 })

    expect(updated.otNumber).toBe(42)
    expect(await listPendingTicketMutations(userId, workspaceId)).toMatchObject([
      { kind: 'ticket.update', payload: { otNumber: 42 } },
    ])
  })

  it('merges server pages without overwriting a locally queued edit', async () => {
    const ticket = await enqueueTicketCreation(userId, workspaceId, ticketInput(0), null)
    await enqueueTicketUpdate(userId, workspaceId, ticket.id, { title: 'Offline correction' })
    await mergeTicketSyncPage(userId, workspaceId, {
      tickets: [
        {
          ...ticket,
          title: 'Server title',
          version: 2,
          updatedAt: new Date(Date.now() + 1).toISOString(),
          clientName: null,
        },
      ],
    })

    expect((await loadLocalTicketPage(userId, workspaceId, null, emptyFilters)).tickets[0]?.title).toBe(
      'Offline correction',
    )
  })

  it('consolidates failed ticket updates into one retryable, versioned mutation', async () => {
    const ticket = await enqueueTicketCreation(userId, workspaceId, ticketInput(0), null)
    const createMutation = (await listPendingTicketMutations(userId, workspaceId))[0]
    if (!createMutation || createMutation.kind !== 'ticket.create') throw new Error('Expected a create mutation.')
    const remoteTicket = { ...ticket, version: 1 }
    await completeTicketMutation(createMutation, remoteTicket)

    await enqueueTicketUpdate(userId, workspaceId, ticket.id, { title: 'First correction' })
    const [firstUpdate] = await listPendingTicketMutations(userId, workspaceId)
    if (!firstUpdate || firstUpdate.kind !== 'ticket.update') throw new Error('Expected an update mutation.')
    await recordTicketMutationFailure(firstUpdate, 'The ticket version changed.', true)
    await enqueueTicketUpdate(userId, workspaceId, ticket.id, { workedHours: 1.25 })

    const retryable = await listPendingTicketMutations(userId, workspaceId)
    expect(retryable).toHaveLength(1)
    expect(retryable[0]).toMatchObject({
      kind: 'ticket.update',
      state: 'pending',
      payload: {
        expectedVersion: 1,
        title: 'First correction',
        workedHours: 1.25,
      },
    })
  })

  it('rebases queued edits and deletion onto the latest server version', async () => {
    const ticket = await enqueueTicketCreation(userId, workspaceId, ticketInput(0), null)
    const createMutation = (await listPendingTicketMutations(userId, workspaceId))[0]
    if (!createMutation || createMutation.kind !== 'ticket.create') throw new Error('Expected a create mutation.')
    await completeTicketMutation(createMutation, { ...ticket, version: 1 })

    await enqueueTicketUpdate(userId, workspaceId, ticket.id, { title: 'First correction' })
    await enqueueTicketUpdate(userId, workspaceId, ticket.id, { workedHours: 2.25 })
    await enqueueTicketDeletion(userId, workspaceId, ticket.id)
    await rebasePendingTicketMutations(userId, workspaceId, ticket.id, { ...ticket, version: 7 })

    expect(await listPendingTicketMutations(userId, workspaceId)).toMatchObject([
      { kind: 'ticket.update', payload: { expectedVersion: 7, title: 'First correction' } },
      { kind: 'ticket.update', payload: { expectedVersion: 8, workedHours: 2.25 } },
      { kind: 'ticket.delete', payload: { expectedVersion: 9 } },
    ])
    expect((await loadLocalTicketPage(userId, workspaceId, null, emptyFilters)).tickets).toEqual([])
  })
})
