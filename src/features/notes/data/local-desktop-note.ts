import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import {
  noteListSchema,
  type CreateNoteMutation,
  type DeleteNoteMutation,
  type NoteCursor,
  type NoteListFilters,
  type UpdateNoteMutation,
} from '../../../../packages/notes/src/contract'

export type LocalDesktopNotePage = z.infer<typeof noteListSchema>

async function invokeNotePage(command: string, args?: Record<string, unknown>): Promise<LocalDesktopNotePage> {
  const result: unknown = await invoke(command, args)
  return noteListSchema.parse(result)
}

export function loadLocalDesktopNotes(workspaceId: string, cursor: NoteCursor | null, filters: NoteListFilters) {
  return invokeNotePage('get_local_notes', { workspaceId, cursor, ticketId: filters.ticketId })
}

export function createLocalDesktopNote(
  input: Pick<CreateNoteMutation, 'id' | 'ticketId' | 'title' | 'content'> & { workspaceId: string },
) {
  return invokeNotePage('create_local_note', { input })
}

export function updateLocalDesktopNote(
  workspaceId: string,
  noteId: string,
  input: Omit<UpdateNoteMutation, 'clientMutationId'>,
  cursor: NoteCursor | null,
  filters: NoteListFilters,
) {
  return invokeNotePage('update_local_note', {
    workspaceId,
    noteId,
    input,
    cursor,
    ticketFilter: filters.ticketId,
  })
}

export async function deleteLocalDesktopNote(
  workspaceId: string,
  noteId: string,
  expectedVersion: DeleteNoteMutation['expectedVersion'],
) {
  const result: unknown = await invoke('delete_local_note', { workspaceId, noteId, expectedVersion })
  return z.object({ deletedAt: z.string().datetime() }).parse(result)
}
