import { z } from 'zod'

export const noteAttachmentPageSize = 25

export const noteAttachmentSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  noteId: z.string().uuid(),
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

export const noteAttachmentCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
})

export const noteAttachmentPageSchema = z.object({
  attachments: z.array(noteAttachmentSchema).max(noteAttachmentPageSize),
  nextCursor: noteAttachmentCursorSchema.nullable(),
})

export const createNoteAttachmentSchema = z.object({
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

export type NoteAttachment = z.infer<typeof noteAttachmentSchema>
export type NoteAttachmentCursor = z.infer<typeof noteAttachmentCursorSchema>
export type NoteAttachmentPage = z.infer<typeof noteAttachmentPageSchema>
export type CreateNoteAttachment = z.input<typeof createNoteAttachmentSchema>
