import { z } from 'zod'

export const workspaceIcons = ['briefcase', 'folder', 'layers', 'notebook-pen', 'laptop', 'palette'] as const
export const workspaceAccents = ['olive', 'blue', 'terracotta', 'plum', 'teal', 'graphite'] as const

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(48),
  accentColor: z.enum(workspaceAccents),
  icon: z.enum(workspaceIcons),
})

export const createWorkspaceMutationSchema = createWorkspaceSchema.extend({
  id: z.string().uuid(),
  clientMutationId: z.string().uuid(),
})

export const activateWorkspaceMutationSchema = z.object({
  clientMutationId: z.string().uuid(),
  accessedAt: z.string().datetime(),
})

export const workspaceSchema = createWorkspaceSchema.extend({
  id: z.string().uuid(),
  lastAccessedAt: z.string().datetime().nullable(),
  version: z.number().int().positive(),
  membershipVersion: z.number().int().positive(),
})

export const workspaceListSchema = z.object({
  workspaces: z.array(workspaceSchema),
  lastWorkspaceId: z.string().nullable(),
  nextCursor: z.string().max(512).nullable(),
})

export const workspaceActivationSchema = z.object({
  workspaceId: z.string().uuid(),
  lastAccessedAt: z.string().datetime(),
  membershipVersion: z.number().int().positive(),
})

export type WorkspaceIcon = (typeof workspaceIcons)[number]
export type WorkspaceAccent = (typeof workspaceAccents)[number]
export type Workspace = z.infer<typeof workspaceSchema>
export type CreateWorkspaceMutation = z.infer<typeof createWorkspaceMutationSchema>
export type ActivateWorkspaceMutation = z.infer<typeof activateWorkspaceMutationSchema>
