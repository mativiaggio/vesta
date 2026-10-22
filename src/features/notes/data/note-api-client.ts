import {
  noteListSchema,
  noteSchema,
  type CreateNoteMutation,
  type DeleteNoteMutation,
  type NoteCursor,
  type NoteListFilters,
  type UpdateNoteMutation,
} from '../../../../packages/notes/src/contract'
import { apiBaseUrl } from '../../../config/runtime-api-base-url'
import { z } from 'zod'

export class NoteApiError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    let code: string | null = null
    try {
      const payload: unknown = await response.json()
      if (typeof payload === 'object' && payload !== null && 'code' in payload && typeof payload.code === 'string') {
        code = payload.code
      }
    } catch {
      code = null
    }
    throw new NoteApiError('Note request failed.', response.status, code)
  }
  return response.json() as Promise<unknown>
}

function notesUrl(workspaceId: string, path = ''): URL {
  return new URL(`/api/workspaces/${encodeURIComponent(workspaceId)}/notes${path}`, apiBaseUrl)
}

export async function fetchNotePage(
  workspaceId: string,
  cursor: NoteCursor | null,
  filters: NoteListFilters,
  signal?: AbortSignal,
) {
  const url = notesUrl(workspaceId)
  if (cursor) url.searchParams.set('cursor', JSON.stringify(cursor))
  if (filters.ticketId) url.searchParams.set('ticketId', filters.ticketId)
  return noteListSchema.parse(await parseResponse(await fetch(url, { credentials: 'include', signal })))
}

export async function fetchNoteSyncPage(workspaceId: string, cursor: NoteCursor | null, signal?: AbortSignal) {
  const url = notesUrl(workspaceId, '/sync')
  if (cursor) url.searchParams.set('cursor', JSON.stringify(cursor))
  return noteListSchema.parse(await parseResponse(await fetch(url, { credentials: 'include', signal })))
}

export async function fetchRemoteNote(workspaceId: string, noteId: string, signal?: AbortSignal) {
  const payload = await parseResponse(
    await fetch(notesUrl(workspaceId, `/${encodeURIComponent(noteId)}`), { credentials: 'include', signal }),
  )
  return noteSchema.parse(typeof payload === 'object' && payload !== null && 'note' in payload ? payload.note : null)
}

export async function createRemoteNote(workspaceId: string, input: CreateNoteMutation, signal?: AbortSignal) {
  const payload = await parseResponse(
    await fetch(notesUrl(workspaceId), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }),
  )
  return noteSchema.parse(typeof payload === 'object' && payload !== null && 'note' in payload ? payload.note : null)
}

export async function updateRemoteNote(
  workspaceId: string,
  noteId: string,
  input: UpdateNoteMutation,
  signal?: AbortSignal,
) {
  const payload = await parseResponse(
    await fetch(notesUrl(workspaceId, `/${encodeURIComponent(noteId)}`), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }),
  )
  return noteSchema.parse(typeof payload === 'object' && payload !== null && 'note' in payload ? payload.note : null)
}

export async function deleteRemoteNote(
  workspaceId: string,
  noteId: string,
  input: DeleteNoteMutation,
  signal?: AbortSignal,
): Promise<{ deletedAt: string }> {
  const payload = await parseResponse(
    await fetch(notesUrl(workspaceId, `/${encodeURIComponent(noteId)}`), {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }),
  )
  return z.object({ deletedAt: z.string().datetime() }).parse(payload)
}
