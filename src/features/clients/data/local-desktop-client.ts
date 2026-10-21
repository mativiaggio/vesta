import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import {
  clientListSchema,
  type ClientCursor,
  type CreateClientMutation,
  type UpdateClientMutation,
} from '../../../../packages/clients/src/contract'

const localClientDeletionSchema = z.object({ deletedAt: z.string().datetime() }).strict()

export type LocalDesktopClientPage = z.infer<typeof clientListSchema>

async function invokeClientPage(command: string, args?: Record<string, unknown>): Promise<LocalDesktopClientPage> {
  const result: unknown = await invoke(command, args)
  return clientListSchema.parse(result)
}

export function loadLocalDesktopClients(
  workspaceId: string,
  cursor: ClientCursor | null,
  search: string,
): Promise<LocalDesktopClientPage> {
  return invokeClientPage('get_local_clients', { workspaceId, cursor, search })
}

export function createLocalDesktopClient(
  input: Pick<CreateClientMutation, 'id' | 'code' | 'name' | 'active'> & { workspaceId: string },
) {
  return invokeClientPage('create_local_client', { input })
}

export function updateLocalDesktopClient(
  workspaceId: string,
  clientId: string,
  input: Omit<UpdateClientMutation, 'clientMutationId'>,
  cursor: ClientCursor | null,
  search: string,
) {
  return invokeClientPage('update_local_client', { workspaceId, clientId, input, cursor, search })
}

export async function deleteLocalDesktopClient(workspaceId: string, clientId: string, expectedVersion: number) {
  const result: unknown = await invoke('delete_local_client', { workspaceId, clientId, expectedVersion })
  return localClientDeletionSchema.parse(result)
}
