import {
  createNoteMutationSchema,
  deleteNoteMutationSchema,
  noteListFiltersSchema,
  updateNoteMutationSchema,
  type NoteCursor,
  type NoteListFilters,
} from '../../../../packages/notes/src/contract.js'
import {
  createNoteForWorkspace,
  deleteNoteForWorkspace,
  getNoteForWorkspace,
  listNotesForWorkspace,
  listNotesForWorkspaceForSync,
  updateNoteForWorkspace,
} from './note-repository.js'

export async function listWorkspaceNotes(
  userId: string,
  workspaceId: string,
  cursor: NoteCursor | null,
  input: unknown,
) {
  const filters = noteListFiltersSchema.safeParse(input)
  if (!filters.success) return { kind: 'invalid' as const }
  return listNotesForWorkspace(userId, workspaceId, cursor, filters.data satisfies NoteListFilters)
}

export function listWorkspaceNotesForSync(userId: string, workspaceId: string, cursor: NoteCursor | null) {
  return listNotesForWorkspaceForSync(userId, workspaceId, cursor)
}

export function getWorkspaceNote(userId: string, workspaceId: string, noteId: string) {
  return getNoteForWorkspace(userId, workspaceId, noteId)
}

export async function createWorkspaceNote(userId: string, workspaceId: string, input: unknown) {
  const parsed = createNoteMutationSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid' as const }
  return createNoteForWorkspace(userId, workspaceId, parsed.data)
}

export async function updateWorkspaceNote(userId: string, workspaceId: string, noteId: string, input: unknown) {
  const parsed = updateNoteMutationSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid' as const }
  return updateNoteForWorkspace(userId, workspaceId, noteId, parsed.data)
}

export async function deleteWorkspaceNote(userId: string, workspaceId: string, noteId: string, input: unknown) {
  const parsed = deleteNoteMutationSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid' as const }
  return deleteNoteForWorkspace(userId, workspaceId, noteId, parsed.data)
}
