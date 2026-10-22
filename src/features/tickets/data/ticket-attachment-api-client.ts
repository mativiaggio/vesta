import {
  ticketAttachmentPageSchema,
  ticketAttachmentSchema,
  type TicketAttachmentCursor,
} from '../../../../packages/tickets/src/attachment-contract'
import { apiBaseUrl } from '../../../config/runtime-api-base-url'

export class TicketAttachmentApiError extends Error {
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
    throw new TicketAttachmentApiError('Ticket attachment request failed.', response.status, code)
  }
  return response.json() as Promise<unknown>
}

function attachmentsUrl(workspaceId: string, ticketId: string, suffix = ''): URL {
  return new URL(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/tickets/${encodeURIComponent(ticketId)}/attachments${suffix}`,
    apiBaseUrl,
  )
}

export async function fetchRemoteTicketAttachments(
  workspaceId: string,
  ticketId: string,
  cursor: TicketAttachmentCursor | null,
  signal?: AbortSignal,
) {
  const url = attachmentsUrl(workspaceId, ticketId)
  if (cursor) url.searchParams.set('cursor', JSON.stringify(cursor))
  return ticketAttachmentPageSchema.parse(await parseJson(await fetch(url, { credentials: 'include', signal })))
}

export async function uploadRemoteTicketAttachment(
  workspaceId: string,
  ticketId: string,
  attachmentId: string,
  file: File,
  signal?: AbortSignal,
) {
  const response = await fetch(attachmentsUrl(workspaceId, ticketId, `/${encodeURIComponent(attachmentId)}`), {
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
  return ticketAttachmentSchema.parse(
    typeof payload === 'object' && payload !== null && 'attachment' in payload ? payload.attachment : null,
  )
}

export function remoteTicketAttachmentUrl(workspaceId: string, ticketId: string, attachmentId: string): string {
  return attachmentsUrl(workspaceId, ticketId, `/${encodeURIComponent(attachmentId)}/content`).toString()
}

export async function fetchRemoteTicketAttachmentContent(
  workspaceId: string,
  ticketId: string,
  attachmentId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(attachmentsUrl(workspaceId, ticketId, `/${encodeURIComponent(attachmentId)}/content`), {
    credentials: 'include',
    signal,
  })
  if (!response.ok) {
    await parseJson(response)
    throw new TicketAttachmentApiError('Ticket attachment preview request failed.', response.status)
  }
  return response.blob()
}

export async function deleteRemoteTicketAttachment(
  workspaceId: string,
  ticketId: string,
  attachmentId: string,
): Promise<void> {
  const response = await fetch(attachmentsUrl(workspaceId, ticketId, `/${encodeURIComponent(attachmentId)}`), {
    method: 'DELETE',
    credentials: 'include',
  })
  if (response.status === 204 || response.status === 404) return
  await parseJson(response)
  throw new TicketAttachmentApiError('Ticket attachment deletion returned an unexpected response.', response.status)
}

export function ticketAttachmentErrorStatus(error: unknown): number | null {
  return error instanceof TicketAttachmentApiError ? error.status : null
}
