import {
  noteAttachmentPageSchema,
  noteAttachmentSchema,
  type NoteAttachmentCursor,
} from '../../../../packages/notes/src/attachment-contract'
import { apiBaseUrl } from '../../../config/runtime-api-base-url'

export class NoteAttachmentApiError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function parseJson(response: Response): Promise<unknown> {
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
    throw new NoteAttachmentApiError('Note attachment request failed.', response.status, code)
  }
  return response.json() as Promise<unknown>
}

function attachmentsUrl(workspaceId: string, noteId: string, suffix = ''): URL {
  return new URL(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/${encodeURIComponent(noteId)}/attachments${suffix}`,
    apiBaseUrl,
  )
}

export async function fetchRemoteNoteAttachments(
  workspaceId: string,
  noteId: string,
  cursor: NoteAttachmentCursor | null,
  signal?: AbortSignal,
) {
  const url = attachmentsUrl(workspaceId, noteId)
  if (cursor) url.searchParams.set('cursor', JSON.stringify(cursor))
  return noteAttachmentPageSchema.parse(await parseJson(await fetch(url, { credentials: 'include', signal })))
}

export async function uploadRemoteNoteAttachment(
  workspaceId: string,
  noteId: string,
  attachmentId: string,
  file: File,
  signal?: AbortSignal,
) {
  const response = await fetch(attachmentsUrl(workspaceId, noteId, `/${encodeURIComponent(attachmentId)}`), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Vesta-File-Name': encodeURIComponent(file.name),
      'X-Vesta-File-Size': String(file.size),
    },
    body: file,
    signal,
  })
  const payload = await parseJson(response)
  return noteAttachmentSchema.parse(
    typeof payload === 'object' && payload !== null && 'attachment' in payload ? payload.attachment : null,
  )
}

export async function fetchRemoteNoteAttachmentContent(
  workspaceId: string,
  noteId: string,
  attachmentId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(attachmentsUrl(workspaceId, noteId, `/${encodeURIComponent(attachmentId)}/content`), {
    credentials: 'include',
    signal,
  })
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
    throw new NoteAttachmentApiError('Note attachment content request failed.', response.status, code)
  }
  return response.blob()
}

export async function deleteRemoteNoteAttachment(workspaceId: string, noteId: string, attachmentId: string) {
  const response = await fetch(attachmentsUrl(workspaceId, noteId, `/${encodeURIComponent(attachmentId)}`), {
    method: 'DELETE',
    credentials: 'include',
  })
  if (response.status === 204 || response.status === 404) return
  await parseJson(response)
  throw new NoteAttachmentApiError('Note attachment deletion returned an unexpected response.', response.status)
}

export function noteAttachmentErrorStatus(error: unknown): number | null {
  return error instanceof NoteAttachmentApiError ? error.status : null
}
