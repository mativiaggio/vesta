import { z } from 'zod'

const clientFieldsSchema = {
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  active: z.boolean(),
}

export const createClientSchema = z.object(clientFieldsSchema)

export const createClientMutationSchema = createClientSchema.extend({
  id: z.string().uuid(),
  clientMutationId: z.string().uuid(),
})

export const updateClientMutationSchema = z
  .object({
    code: clientFieldsSchema.code.optional(),
    name: clientFieldsSchema.name.optional(),
    active: clientFieldsSchema.active.optional(),
    expectedVersion: z.number().int().positive(),
    clientMutationId: z.string().uuid(),
  })
  .refine((input) => input.code !== undefined || input.name !== undefined || input.active !== undefined)

export const deleteClientMutationSchema = z.object({
  expectedVersion: z.number().int().positive(),
  clientMutationId: z.string().uuid(),
})

export const clientSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  ...clientFieldsSchema,
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
  createdByUserId: z.string().min(1),
  updatedByUserId: z.string().min(1),
  deletedByUserId: z.string().min(1).nullable(),
})

export const clientCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
})

export const clientPageSize = 25

export const clientSearchSchema = z.string().trim().max(120)

export const clientListSchema = z.object({
  clients: z.array(clientSchema).max(clientPageSize),
  nextCursor: clientCursorSchema.nullable(),
})

export function normalizeClientCode(code: string): string {
  return code.replace(/[A-Z]/g, (character) => character.toLowerCase())
}

export type Client = z.infer<typeof clientSchema>
export type ClientCursor = z.infer<typeof clientCursorSchema>
export type CreateClientMutation = z.infer<typeof createClientMutationSchema>
export type UpdateClientMutation = z.infer<typeof updateClientMutationSchema>
export type DeleteClientMutation = z.infer<typeof deleteClientMutationSchema>
