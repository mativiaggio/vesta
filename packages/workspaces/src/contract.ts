import { z } from 'zod'

export const workspaceIcons = ['briefcase', 'folder', 'layers', 'notebook-pen', 'laptop', 'palette'] as const
export const workspaceAccents = ['olive', 'blue', 'terracotta', 'plum', 'teal', 'graphite'] as const

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(48),
  accentColor: z.enum(workspaceAccents),
  icon: z.enum(workspaceIcons),
})

export const workspaceSchema = createWorkspaceSchema.extend({
  id: z.string().min(1),
  lastAccessedAt: z.string().datetime().nullable(),
})

export const workspaceListSchema = z.object({
  workspaces: z.array(workspaceSchema),
  lastWorkspaceId: z.string().nullable(),
  nextOffset: z.number().int().nonnegative().nullable(),
})

export type WorkspaceIcon = (typeof workspaceIcons)[number]
export type WorkspaceAccent = (typeof workspaceAccents)[number]
export type Workspace = z.infer<typeof workspaceSchema>
