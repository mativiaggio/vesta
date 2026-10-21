import {
  createClientMutationSchema,
  deleteClientMutationSchema,
  updateClientMutationSchema,
} from '../../../../packages/clients/src/contract.js'
import type { ClientCursor } from '../../../../packages/clients/src/contract.js'
import {
  createClientForWorkspace,
  deleteClientForWorkspace,
  listClientsForWorkspace,
  listClientsForWorkspaceForSync,
  updateClientForWorkspace,
} from './client-repository.js'

export async function listWorkspaceClients(
  userId: string,
  workspaceId: string,
  cursor: ClientCursor | null,
  search: string,
) {
  return listClientsForWorkspace(userId, workspaceId, cursor, search)
}

export async function listWorkspaceClientsForSync(userId: string, workspaceId: string, cursor: ClientCursor | null) {
  return listClientsForWorkspaceForSync(userId, workspaceId, cursor)
}

export async function createWorkspaceClient(userId: string, workspaceId: string, input: unknown) {
  const parsed = createClientMutationSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid' as const }
  return createClientForWorkspace(userId, workspaceId, parsed.data)
}

export async function updateWorkspaceClient(userId: string, workspaceId: string, clientId: string, input: unknown) {
  const parsed = updateClientMutationSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid' as const }
  return updateClientForWorkspace(userId, workspaceId, clientId, parsed.data)
}

export async function deleteWorkspaceClient(userId: string, workspaceId: string, clientId: string, input: unknown) {
  const parsed = deleteClientMutationSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid' as const }
  return deleteClientForWorkspace(userId, workspaceId, clientId, parsed.data)
}
