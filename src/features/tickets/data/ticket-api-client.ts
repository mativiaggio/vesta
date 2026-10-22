import {
  ticketListSchema,
  ticketSchema,
  type CreateTicketMutation,
  type DeleteTicketMutation,
  type TicketCursor,
  type TicketListFilters,
  type UpdateTicketMutation,
} from '../../../../packages/tickets/src/contract'
import { apiBaseUrl } from '../../../config/runtime-api-base-url'
import { z } from 'zod'

export class TicketApiError extends Error {
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
    throw new TicketApiError('Ticket request failed.', response.status, code)
  }
  return response.json() as Promise<unknown>
}

function ticketUrl(workspaceId: string, path = ''): URL {
  return new URL(`/api/workspaces/${encodeURIComponent(workspaceId)}/tickets${path}`, apiBaseUrl)
}

export async function fetchTicketPage(
  workspaceId: string,
  cursor: TicketCursor | null,
  filters: TicketListFilters,
  signal?: AbortSignal,
) {
  const url = ticketUrl(workspaceId)
  if (cursor) url.searchParams.set('cursor', JSON.stringify(cursor))
  if (filters.status) url.searchParams.set('status', filters.status)
  if (filters.priority) url.searchParams.set('priority', filters.priority)
  if (filters.search) url.searchParams.set('search', filters.search)
  return ticketListSchema.parse(await parseResponse(await fetch(url, { credentials: 'include', signal })))
}

export async function fetchNextTicketOtNumber(workspaceId: string, signal?: AbortSignal): Promise<number> {
  const payload = await parseResponse(
    await fetch(ticketUrl(workspaceId, '/next-number'), { credentials: 'include', signal }),
  )
  return z.object({ nextNumber: z.number().int().min(1).max(2_147_483_647) }).parse(payload).nextNumber
}

export async function fetchTicketSyncPage(workspaceId: string, cursor: TicketCursor | null, signal?: AbortSignal) {
  const url = ticketUrl(workspaceId, '/sync')
  if (cursor) url.searchParams.set('cursor', JSON.stringify(cursor))
  return ticketListSchema.parse(await parseResponse(await fetch(url, { credentials: 'include', signal })))
}

export async function fetchRemoteTicket(workspaceId: string, ticketId: string, signal?: AbortSignal) {
  const payload = await parseResponse(
    await fetch(ticketUrl(workspaceId, `/${encodeURIComponent(ticketId)}`), {
      credentials: 'include',
      signal,
    }),
  )
  return ticketSchema.parse(
    typeof payload === 'object' && payload !== null && 'ticket' in payload ? payload.ticket : null,
  )
}

export async function createRemoteTicket(workspaceId: string, input: CreateTicketMutation, signal?: AbortSignal) {
  const payload = await parseResponse(
    await fetch(ticketUrl(workspaceId), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }),
  )
  return ticketSchema.parse(
    typeof payload === 'object' && payload !== null && 'ticket' in payload ? payload.ticket : null,
  )
}

export async function updateRemoteTicket(
  workspaceId: string,
  ticketId: string,
  input: UpdateTicketMutation,
  signal?: AbortSignal,
) {
  const payload = await parseResponse(
    await fetch(ticketUrl(workspaceId, `/${encodeURIComponent(ticketId)}`), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }),
  )
  return ticketSchema.parse(
    typeof payload === 'object' && payload !== null && 'ticket' in payload ? payload.ticket : null,
  )
}

export async function deleteRemoteTicket(
  workspaceId: string,
  ticketId: string,
  input: DeleteTicketMutation,
  signal?: AbortSignal,
): Promise<{ deletedAt: string }> {
  const payload = await parseResponse(
    await fetch(ticketUrl(workspaceId, `/${encodeURIComponent(ticketId)}`), {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }),
  )
  return z.object({ deletedAt: z.string().datetime() }).parse(payload)
}
