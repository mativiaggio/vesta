import {
  workspaceActivationSchema,
  workspaceListSchema,
  workspaceSchema,
  type ActivateWorkspaceMutation,
  type CreateWorkspaceMutation,
} from '../../../../packages/workspaces/src/contract'
import { apiBaseUrl } from '../../../config/runtime-api-base-url'

export class WorkspaceApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new WorkspaceApiError('Workspace request failed.', response.status)
  return response.json() as Promise<unknown>
}

export async function fetchWorkspacePage(cursor: string | null, signal?: AbortSignal) {
  const url = new URL('/api/workspaces', apiBaseUrl)
  if (cursor) url.searchParams.set('cursor', cursor)
  return workspaceListSchema.parse(
    await parseResponse(
      await fetch(url, {
        credentials: 'include',
        signal,
      }),
    ),
  )
}

export async function createRemoteWorkspace(input: CreateWorkspaceMutation, signal?: AbortSignal) {
  const payload = await parseResponse(
    await fetch(new URL('/api/workspaces', apiBaseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }),
  )
  return workspaceSchema.parse(
    typeof payload === 'object' && payload !== null && 'workspace' in payload ? payload.workspace : null,
  )
}

export async function activateRemoteWorkspace(
  workspaceId: string,
  input: ActivateWorkspaceMutation,
  signal?: AbortSignal,
) {
  const payload = await parseResponse(
    await fetch(new URL(`/api/workspaces/${encodeURIComponent(workspaceId)}/activate`, apiBaseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }),
  )
  return workspaceActivationSchema.parse(
    typeof payload === 'object' && payload !== null && 'activation' in payload ? payload.activation : null,
  )
}
