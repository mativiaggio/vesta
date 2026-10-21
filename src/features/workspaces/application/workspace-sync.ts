import {
  activateRemoteWorkspace,
  createRemoteWorkspace,
  deleteRemoteWorkspace,
  updateRemoteWorkspace,
  WorkspaceApiError,
} from '../data/workspace-api-client'
import {
  completeActivationMutation,
  completeWorkspaceMutation,
  completeWorkspaceDeletionMutation,
  listPendingWorkspaceMutations,
  recordWorkspaceMutationFailure,
} from '../data/workspace-local-store'

export type WorkspaceSyncResult = { pendingCount: number; hasFailedMutations: boolean }

export async function syncPendingWorkspaceMutations(
  userId: string,
  signal?: AbortSignal,
): Promise<WorkspaceSyncResult> {
  const mutations = await listPendingWorkspaceMutations(userId)
  let pendingCount = mutations.length
  let hasFailedMutations = false

  for (const mutation of mutations) {
    if (signal?.aborted) break
    try {
      if (mutation.kind === 'workspace.create') {
        const workspace = await createRemoteWorkspace(mutation.payload, signal)
        await completeWorkspaceMutation(mutation, workspace)
      } else if (mutation.kind === 'workspace.activate') {
        const activation = await activateRemoteWorkspace(mutation.workspaceId, mutation.payload, signal)
        await completeActivationMutation(mutation, activation)
      } else if (mutation.kind === 'workspace.delete') {
        const deletion = await deleteRemoteWorkspace(mutation.workspaceId, mutation.payload, signal)
        await completeWorkspaceDeletionMutation(mutation, deletion.deletedAt)
      } else {
        const workspace = await updateRemoteWorkspace(mutation.workspaceId, mutation.payload, signal)
        await completeWorkspaceMutation(mutation, workspace)
      }
      pendingCount -= 1
    } catch (error) {
      if (signal?.aborted) break
      const permanent =
        error instanceof WorkspaceApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![401, 403, 408, 429].includes(error.status)
      await recordWorkspaceMutationFailure(
        mutation,
        error instanceof Error ? error.message : 'Unknown synchronization failure.',
        permanent,
      )
      if (permanent) {
        pendingCount -= 1
        hasFailedMutations = true
        continue
      }
      break
    }
  }

  return { pendingCount, hasFailedMutations }
}
