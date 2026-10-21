import {
  clientListSchema,
  clientSchema,
  type ClientCursor,
  type CreateClientMutation,
  type DeleteClientMutation,
  type UpdateClientMutation,
} from '../../../../packages/clients/src/contract'
import { apiBaseUrl } from '../../../config/runtime-api-base-url'
import { z } from 'zod'

export class ClientApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new ClientApiError('Client request failed.', response.status)
  return response.json() as Promise<unknown>
}

function clientUrl(workspaceId: string, path = ''): URL {
  return new URL(`/api/workspaces/${encodeURIComponent(workspaceId)}/clients${path}`, apiBaseUrl)
}

export async function fetchClientPage(
  workspaceId: string,
  cursor: ClientCursor | null,
  search: string,
  signal?: AbortSignal,
) {
  const url = clientUrl(workspaceId)
  if (cursor) url.searchParams.set('cursor', JSON.stringify(cursor))
  if (search) url.searchParams.set('search', search)
  return clientListSchema.parse(await parseResponse(await fetch(url, { credentials: 'include', signal })))
}

export async function fetchClientSyncPage(workspaceId: string, cursor: ClientCursor | null, signal?: AbortSignal) {
  const url = clientUrl(workspaceId, '/sync')
  if (cursor) url.searchParams.set('cursor', JSON.stringify(cursor))
  return clientListSchema.parse(await parseResponse(await fetch(url, { credentials: 'include', signal })))
}

export async function createRemoteClient(workspaceId: string, input: CreateClientMutation, signal?: AbortSignal) {
  const payload = await parseResponse(
    await fetch(clientUrl(workspaceId), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }),
  )
  return clientSchema.parse(
    typeof payload === 'object' && payload !== null && 'client' in payload ? payload.client : null,
  )
}

export async function updateRemoteClient(
  workspaceId: string,
  clientId: string,
  input: UpdateClientMutation,
  signal?: AbortSignal,
) {
  const payload = await parseResponse(
    await fetch(clientUrl(workspaceId, `/${encodeURIComponent(clientId)}`), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }),
  )
  return clientSchema.parse(
    typeof payload === 'object' && payload !== null && 'client' in payload ? payload.client : null,
  )
}

export async function deleteRemoteClient(
  workspaceId: string,
  clientId: string,
  input: DeleteClientMutation,
  signal?: AbortSignal,
): Promise<{ deletedAt: string }> {
  const payload = await parseResponse(
    await fetch(clientUrl(workspaceId, `/${encodeURIComponent(clientId)}`), {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }),
  )
  return zodDeletionSchema.parse(payload)
}

const zodDeletionSchema = z.object({ deletedAt: z.string().datetime() })
