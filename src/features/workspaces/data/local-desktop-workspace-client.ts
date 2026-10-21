import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import type { CreateWorkspaceMutation, UpdateWorkspaceMutation } from '../../../../packages/workspaces/src/contract'
import { workspaceSchema } from '../../../../packages/workspaces/src/contract'

const localWorkspaceStateSchema = z
  .object({
    workspaces: z.array(workspaceSchema),
    activeWorkspaceId: z.string().uuid().nullable(),
  })
  .strict()

export type LocalDesktopWorkspaceState = z.infer<typeof localWorkspaceStateSchema>

async function invokeWorkspaceState(
  command: string,
  args?: Record<string, unknown>,
): Promise<LocalDesktopWorkspaceState> {
  const result: unknown = await invoke(command, args)
  return localWorkspaceStateSchema.parse(result)
}

export function loadLocalDesktopWorkspaceState(): Promise<LocalDesktopWorkspaceState> {
  return invokeWorkspaceState('get_local_workspace_state')
}

export function createLocalDesktopWorkspace(
  input: Omit<CreateWorkspaceMutation, 'clientMutationId'>,
): Promise<LocalDesktopWorkspaceState> {
  return invokeWorkspaceState('create_local_workspace', { input })
}

export function updateLocalDesktopWorkspace(
  workspaceId: string,
  input: Omit<UpdateWorkspaceMutation, 'clientMutationId'>,
): Promise<LocalDesktopWorkspaceState> {
  return invokeWorkspaceState('update_local_workspace', { workspaceId, input })
}

export function deleteLocalDesktopWorkspace(workspaceId: string, confirmationName: string) {
  return invokeWorkspaceState('delete_local_workspace', { workspaceId, confirmationName })
}

export function activateLocalDesktopWorkspace(workspaceId: string) {
  return invokeWorkspaceState('activate_local_workspace', { workspaceId })
}
