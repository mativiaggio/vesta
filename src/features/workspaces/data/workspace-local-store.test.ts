import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CreateWorkspaceMutation } from '../../../../packages/workspaces/src/contract'
import {
  completeWorkspaceMutation,
  enqueueWorkspaceActivation,
  enqueueWorkspaceCreation,
  listPendingWorkspaceMutations,
  loadLocalWorkspaceState,
  resetWorkspaceLocalDatabaseForTests,
} from './workspace-local-store'

const userId = 'user-1'
const createMutation: CreateWorkspaceMutation = {
  id: '9fcd84af-2f30-4cf8-8c57-ae181b4b4e09',
  clientMutationId: 'c54a1836-ae43-47ec-af50-1b64c2c4c55e',
  name: 'Studio North',
  accentColor: 'olive',
  icon: 'briefcase',
}

describe('workspace local store', () => {
  beforeEach(resetWorkspaceLocalDatabaseForTests)
  afterEach(resetWorkspaceLocalDatabaseForTests)

  it('durably commits a workspace and its pending mutation together', async () => {
    await enqueueWorkspaceCreation(userId, createMutation)

    const state = await loadLocalWorkspaceState(userId)
    const mutations = await listPendingWorkspaceMutations(userId)

    expect(state.workspaces).toHaveLength(1)
    expect(state.activeWorkspaceId).toBe(createMutation.id)
    expect(state.pendingCount).toBe(1)
    expect(mutations).toMatchObject([
      {
        id: createMutation.clientMutationId,
        kind: 'workspace.create',
        payload: createMutation,
      },
    ])
  })

  it('keeps an offline activation queued across reads', async () => {
    await enqueueWorkspaceCreation(userId, createMutation)
    await completeWorkspaceMutation((await listPendingWorkspaceMutations(userId))[0], {
      ...createMutation,
      lastAccessedAt: '2026-10-20T12:00:00.000Z',
      version: 1,
      membershipVersion: 1,
    })

    await enqueueWorkspaceActivation(userId, createMutation.id, {
      clientMutationId: '19b6d284-ae17-403f-a11b-e855d929a895',
      accessedAt: '2026-10-20T13:00:00.000Z',
    })

    const state = await loadLocalWorkspaceState(userId)
    expect(state.activeWorkspaceId).toBe(createMutation.id)
    expect(state.workspaces[0]?.lastAccessedAt).toBe('2026-10-20T13:00:00.000Z')
    expect(state.pendingCount).toBe(1)
  })

  it('isolates durable replicas by authenticated user', async () => {
    await enqueueWorkspaceCreation(userId, createMutation)

    const otherUserState = await loadLocalWorkspaceState('user-2')
    expect(otherUserState.workspaces).toEqual([])
    expect(otherUserState.pendingCount).toBe(0)
  })
})
