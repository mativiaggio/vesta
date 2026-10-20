import { createWorkspaceSchema } from '../../../../../packages/workspaces/src/contract.js'
import { activateWorkspaceForUser, createWorkspaceForUser, listWorkspacePageForUser } from '../data/workspace-repository.js'

export function listWorkspaces(userId: string, offset: number) {
  return listWorkspacePageForUser(userId, offset)
}

export async function createWorkspace(userId: string, input: unknown) {
  const parsed = createWorkspaceSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid' as const }

  const workspace = await createWorkspaceForUser(userId, parsed.data)
  return { kind: 'created' as const, workspace }
}

export function activateWorkspace(userId: string, workspaceId: string) {
  return activateWorkspaceForUser(userId, workspaceId)
}
