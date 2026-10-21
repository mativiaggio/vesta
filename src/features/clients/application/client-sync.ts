import {
  ClientApiError,
  createRemoteClient,
  deleteRemoteClient,
  fetchClientSyncPage,
  updateRemoteClient,
} from '../data/client-api-client'
import {
  completeClientDeletionMutation,
  completeClientMutation,
  listPendingClientMutations,
  mergeClientSyncPage,
  recordClientMutationFailure,
} from '../data/client-local-store'
import type { ClientCursor } from '../../../../packages/clients/src/contract'

export async function syncPendingClientMutations(
  userId: string,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<{ pendingCount: number; hasFailedMutations: boolean }> {
  let hasFailedMutations = false

  while (!signal?.aborted) {
    const [mutation] = await listPendingClientMutations(userId, workspaceId)
    if (!mutation) break
    if (signal?.aborted) break
    try {
      if (mutation.kind === 'client.create') {
        const client = await createRemoteClient(workspaceId, mutation.payload, signal)
        await completeClientMutation(mutation, client)
      } else if (mutation.kind === 'client.update') {
        const client = await updateRemoteClient(workspaceId, mutation.clientId, mutation.payload, signal)
        await completeClientMutation(mutation, client)
      } else {
        const deletion = await deleteRemoteClient(workspaceId, mutation.clientId, mutation.payload, signal)
        await completeClientDeletionMutation(mutation, deletion.deletedAt)
      }
    } catch (error) {
      if (signal?.aborted) break
      const permanent =
        error instanceof ClientApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![401, 403, 408, 429].includes(error.status)
      await recordClientMutationFailure(
        mutation,
        error instanceof Error ? error.message : 'Unknown synchronization failure.',
        permanent,
      )
      if (permanent) {
        hasFailedMutations = true
        continue
      }
      break
    }
  }

  return {
    pendingCount: (await listPendingClientMutations(userId, workspaceId)).length,
    hasFailedMutations,
  }
}

export async function refreshClientsFromServer(
  userId: string,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<void> {
  let cursor: ClientCursor | null = null
  do {
    const page = await fetchClientSyncPage(workspaceId, cursor, signal)
    await mergeClientSyncPage(userId, workspaceId, page)
    cursor = page.nextCursor
  } while (cursor && !signal?.aborted)
}
