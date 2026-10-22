import { z } from 'zod'

export const ticketAttachmentPageSize = 25

export const ticketAttachmentSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  ticketId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  contentType: z
    .string()
    .regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/)
    .max(255),
  sizeBytes: z.number().int().nonnegative().safe(),
  checksumSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
})

export const ticketAttachmentCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
})

export const ticketAttachmentPageSchema = z.object({
  attachments: z.array(ticketAttachmentSchema).max(ticketAttachmentPageSize),
  nextCursor: ticketAttachmentCursorSchema.nullable(),
})

export const createTicketAttachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  contentType: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/)
    .max(255)
    .default('application/octet-stream'),
  sizeBytes: z.number().int().nonnegative().safe(),
})

export type TicketAttachment = z.infer<typeof ticketAttachmentSchema>
export type TicketAttachmentCursor = z.infer<typeof ticketAttachmentCursorSchema>
export type TicketAttachmentPage = z.infer<typeof ticketAttachmentPageSchema>
export type CreateTicketAttachment = z.input<typeof createTicketAttachmentSchema>
