import { z } from 'zod'

export const ticketPriorities = ['urgent', 'high', 'medium', 'low'] as const
export const ticketStatuses = [
  'requested',
  'analysis',
  'development',
  'review',
  'correction',
  'delivered',
  'production',
] as const

const ticketFieldsSchema = {
  otNumber: z.number().int().min(1).max(2_147_483_647),
  clientId: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20_000),
  priority: z.enum(ticketPriorities),
  status: z.enum(ticketStatuses),
  estimatedHours: z.number().finite().min(0).max(999_999.99).multipleOf(0.01),
  workedHours: z.number().finite().min(0).max(999_999.99).multipleOf(0.01),
}

export const createTicketSchema = z.object(ticketFieldsSchema)

export const createTicketMutationSchema = createTicketSchema.extend({
  id: z.string().uuid(),
  clientMutationId: z.string().uuid(),
})

export const updateTicketMutationSchema = z
  .object({
    otNumber: ticketFieldsSchema.otNumber.optional(),
    clientId: ticketFieldsSchema.clientId.optional(),
    title: ticketFieldsSchema.title.optional(),
    description: ticketFieldsSchema.description.optional(),
    priority: ticketFieldsSchema.priority.optional(),
    status: ticketFieldsSchema.status.optional(),
    estimatedHours: ticketFieldsSchema.estimatedHours.optional(),
    workedHours: ticketFieldsSchema.workedHours.optional(),
    expectedVersion: z.number().int().positive(),
    clientMutationId: z.string().uuid(),
  })
  .refine((input) =>
    [
      input.clientId,
      input.otNumber,
      input.title,
      input.description,
      input.priority,
      input.status,
      input.estimatedHours,
      input.workedHours,
    ].some((value) => value !== undefined),
  )

export const deleteTicketMutationSchema = z.object({
  expectedVersion: z.number().int().positive(),
  clientMutationId: z.string().uuid(),
})

export const ticketSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  ...ticketFieldsSchema,
  codingFinishedAt: z.string().datetime().nullable(),
  productionAt: z.string().datetime().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
  createdByUserId: z.string().min(1),
  updatedByUserId: z.string().min(1),
  deletedByUserId: z.string().min(1).nullable(),
  clientName: z.string().nullable(),
})

export const ticketCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
})

export const ticketPageSize = 25
export const ticketSearchSchema = z.string().trim().max(120)
export const ticketPriorityFilterSchema = z.enum(ticketPriorities).nullable()
export const ticketStatusFilterSchema = z.enum(ticketStatuses).nullable()

export const ticketListFiltersSchema = z.object({
  status: ticketStatusFilterSchema,
  priority: ticketPriorityFilterSchema,
  search: ticketSearchSchema,
})

export const ticketListSchema = z.object({
  tickets: z.array(ticketSchema).max(ticketPageSize),
  nextCursor: ticketCursorSchema.nullable(),
})

export type Ticket = z.infer<typeof ticketSchema>
export type TicketCursor = z.infer<typeof ticketCursorSchema>
export type TicketPriority = (typeof ticketPriorities)[number]
export type TicketStatus = (typeof ticketStatuses)[number]
export type TicketListFilters = z.infer<typeof ticketListFiltersSchema>
export type CreateTicketMutation = z.infer<typeof createTicketMutationSchema>
export type UpdateTicketMutation = z.infer<typeof updateTicketMutationSchema>
export type DeleteTicketMutation = z.infer<typeof deleteTicketMutationSchema>
