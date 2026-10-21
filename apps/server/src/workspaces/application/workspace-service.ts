import {
  createWorkspaceMutationSchema,
  deleteWorkspaceMutationSchema,
  updateWorkspaceMutationSchema,
  type ActivateWorkspaceMutation,
} from '../../../../../packages/workspaces/src/contract.js'
import { encodeWorkspaceCursor, type WorkspaceCursor } from './workspace-cursor.js'
import {
  activateWorkspaceForUser,
  createWorkspaceForUser,
  deleteWorkspaceForUser,
  listWorkspacePageForUser,
  updateWorkspaceForUser,
} from '../data/workspace-repository.js'

export async function listWorkspaces(userId: string, cursor: WorkspaceCursor | null) {
  const page = await listWorkspacePageForUser(userId, cursor)
  return {
    ...page,
    nextCursor: page.nextCursor ? encodeWorkspaceCursor(page.nextCursor) : null,
  }
}

export async function createWorkspace(userId: string, input: unknown) {
  const parsed = createWorkspaceMutationSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid' as const }

  return createWorkspaceForUser(userId, parsed.data)
}

export function activateWorkspace(userId: string, workspaceId: string, mutation: ActivateWorkspaceMutation) {
  return activateWorkspaceForUser(userId, workspaceId, mutation)
}

export async function updateWorkspace(userId: string, workspaceId: string, input: unknown) {
  const parsed = updateWorkspaceMutationSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid' as const }

  return updateWorkspaceForUser(userId, workspaceId, parsed.data)
}

export async function deleteWorkspace(userId: string, workspaceId: string, input: unknown) {
  const parsed = deleteWorkspaceMutationSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid' as const }

  return deleteWorkspaceForUser(userId, workspaceId, parsed.data)
}
