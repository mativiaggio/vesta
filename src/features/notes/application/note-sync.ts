import type { NoteCursor } from '../../../../packages/notes/src/contract'
import {
  NoteApiError,
  createRemoteNote,
  deleteRemoteNote,
  fetchNoteSyncPage,
  fetchRemoteNote,
  updateRemoteNote,
} from '../data/note-api-client'
import {
  completeNoteDeletion,
  completeNoteMutation,
  listPendingNoteMutations,
  markNoteMutationSyncing,
  markNoteReplicaHydrated,
  mergeNoteSyncPage,
  recoverInterruptedNoteMutations,
  recordNoteVersionConflict,
  recordNoteMutationFailure,
} from '../data/note-local-store'

const activeNoteSyncs = new Map<string, Promise<void>>()

export function syncPendingNoteMutations(userId: string, workspaceId: string, signal?: AbortSignal): Promise<void> {
  const scope = JSON.stringify([userId, workspaceId])
  const active = activeNoteSyncs.get(scope)
  if (active) return active
  const operation = runPendingNoteMutations(userId, workspaceId, signal)
  const shared = operation.finally(() => activeNoteSyncs.delete(scope))
  activeNoteSyncs.set(scope, shared)
  return shared
}

async function runPendingNoteMutations(userId: string, workspaceId: string, signal?: AbortSignal): Promise<void> {
  await recoverInterruptedNoteMutations(userId, workspaceId)
  while (!signal?.aborted) {
    const [mutation] = await listPendingNoteMutations(userId, workspaceId)
    if (!mutation) return
    await markNoteMutationSyncing(mutation)
    try {
      if (mutation.kind === 'note.create') {
        await completeNoteMutation(mutation, await createRemoteNote(workspaceId, mutation.payload, signal))
      } else if (mutation.kind === 'note.update') {
        await completeNoteMutation(
          mutation,
          await updateRemoteNote(workspaceId, mutation.noteId, mutation.payload, signal),
        )
      } else {
        const result = await deleteRemoteNote(workspaceId, mutation.noteId, mutation.payload, signal)
        await completeNoteDeletion(mutation, result.deletedAt)
      }
    } catch (error) {
      if (signal?.aborted) return
      if (mutation.kind !== 'note.create' && error instanceof NoteApiError && error.code === 'version-conflict') {
        try {
          const remote = await fetchRemoteNote(workspaceId, mutation.noteId, signal)
          await recordNoteVersionConflict(mutation, remote)
        } catch (refreshError) {
          if (signal?.aborted) return
          const remoteWasDeleted = refreshError instanceof NoteApiError && refreshError.status === 404
          await recordNoteMutationFailure(
            mutation,
            remoteWasDeleted ? 'remote-note-unavailable' : 'version-conflict-refresh-failed',
            remoteWasDeleted,
          )
          if (!remoteWasDeleted) return
        }
        continue
      }
      const permanent =
        error instanceof NoteApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![401, 403, 408, 429].includes(error.status)
      const message =
        error instanceof NoteApiError && error.code
          ? error.code
          : error instanceof Error
            ? error.message
            : 'Note synchronization failed.'
      await recordNoteMutationFailure(mutation, message, permanent)
      if (!permanent) return
    }
  }
}

export async function refreshNotesFromServer(userId: string, workspaceId: string, signal?: AbortSignal): Promise<void> {
  let cursor: NoteCursor | null = null
  do {
    const page = await fetchNoteSyncPage(workspaceId, cursor, signal)
    await mergeNoteSyncPage(userId, workspaceId, page.notes)
    cursor = page.nextCursor
  } while (cursor && !signal?.aborted)
  if (!signal?.aborted) await markNoteReplicaHydrated(userId, workspaceId)
}
