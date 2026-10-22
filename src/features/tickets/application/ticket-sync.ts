import {
  TicketApiError,
  createRemoteTicket,
  deleteRemoteTicket,
  fetchRemoteTicket,
  fetchTicketSyncPage,
  updateRemoteTicket,
} from '../data/ticket-api-client'
import {
  completeTicketDeletionMutation,
  completeTicketMutation,
  listPendingTicketMutations,
  markTicketReplicaHydrated,
  mergeTicketSyncPage,
  rebasePendingTicketMutations,
  recordTicketMutationFailure,
} from '../data/ticket-local-store'
import type { TicketCursor } from '../../../../packages/tickets/src/contract'

const activeTicketSyncs = new Map<string, Promise<void>>()

export function syncPendingTicketMutations(userId: string, workspaceId: string, signal?: AbortSignal): Promise<void> {
  const scope = JSON.stringify([userId, workspaceId])
  const active = activeTicketSyncs.get(scope)
  if (active) return active

  const operation = runPendingTicketMutations(userId, workspaceId, signal)
  const shared = operation.finally(() => activeTicketSyncs.delete(scope))
  activeTicketSyncs.set(scope, shared)
  return shared
}

async function runPendingTicketMutations(userId: string, workspaceId: string, signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted) {
    const [mutation] = await listPendingTicketMutations(userId, workspaceId)
    if (!mutation) return
    try {
      if (mutation.kind === 'ticket.create') {
        const saved = await createRemoteTicket(workspaceId, mutation.payload, signal)
        await completeTicketMutation(mutation, saved)
      } else if (mutation.kind === 'ticket.update') {
        const saved = await updateRemoteTicket(workspaceId, mutation.ticketId, mutation.payload, signal)
        await completeTicketMutation(mutation, saved)
      } else {
        const deletion = await deleteRemoteTicket(workspaceId, mutation.ticketId, mutation.payload, signal)
        await completeTicketDeletionMutation(mutation, deletion.deletedAt)
      }
    } catch (error) {
      if (signal?.aborted) return
      if (
        error instanceof TicketApiError &&
        error.status === 409 &&
        error.code === 'version-conflict' &&
        mutation.kind !== 'ticket.create'
      ) {
        try {
          const remoteTicket = await fetchRemoteTicket(workspaceId, mutation.ticketId, signal)
          await rebasePendingTicketMutations(userId, workspaceId, mutation.ticketId, remoteTicket)
          continue
        } catch (rebaseError) {
          if (signal?.aborted) return
          const permanentRebaseFailure = rebaseError instanceof TicketApiError && rebaseError.status === 404
          await recordTicketMutationFailure(
            mutation,
            rebaseError instanceof Error ? rebaseError.message : 'Ticket synchronization failed.',
            permanentRebaseFailure,
          )
          if (!permanentRebaseFailure) return
          continue
        }
      }
      const permanent =
        error instanceof TicketApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![401, 403, 408, 429].includes(error.status)
      await recordTicketMutationFailure(
        mutation,
        error instanceof TicketApiError && error.code
          ? error.code
          : error instanceof Error
            ? error.message
            : 'Ticket synchronization failed.',
        permanent,
      )
      if (!permanent) return
    }
  }
}

export async function refreshTicketsFromServer(
  userId: string,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<void> {
  let cursor: TicketCursor | null = null
  do {
    const page = await fetchTicketSyncPage(workspaceId, cursor, signal)
    await mergeTicketSyncPage(userId, workspaceId, page)
    cursor = page.nextCursor
  } while (cursor && !signal?.aborted)
  if (!signal?.aborted) await markTicketReplicaHydrated(userId, workspaceId)
}
