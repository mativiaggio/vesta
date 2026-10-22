import { z } from 'zod'

export const notePageSize = 25

export type RichTextMark = {
  type: 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'link'
  attrs?: {
    href?: string
    target?: '_blank' | '_self'
    rel?: string | null
    class?: string | null
    title?: string | null
  }
}

export type RichTextNode = {
  type:
    | 'doc'
    | 'paragraph'
    | 'heading'
    | 'bulletList'
    | 'orderedList'
    | 'listItem'
    | 'blockquote'
    | 'codeBlock'
    | 'horizontalRule'
    | 'text'
    | 'hardBreak'
  attrs?: { level?: 1 | 2 | 3; start?: number; type?: string | null; language?: string | null }
  text?: string
  marks?: RichTextMark[]
  content?: RichTextNode[]
}

export type RichTextDocument = RichTextNode & { type: 'doc'; content: RichTextNode[] }

const markTypes = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link'])
const blockTypes = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
])
const inlineTypes = new Set(['text', 'hardBreak'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeHref(value: string): boolean {
  try {
    const parsed = new URL(value)
    return ['https:', 'http:', 'mailto:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

function isRichTextDocument(value: unknown): value is RichTextDocument {
  if (
    !isRecord(value) ||
    value.type !== 'doc' ||
    !Array.isArray(value.content) ||
    Object.keys(value).some((key) => key !== 'type' && key !== 'content')
  )
    return false
  const stack: Array<{ node: unknown; depth: number; parent: string }> = value.content.map((node: unknown) => ({
    node,
    depth: 1,
    parent: 'doc',
  }))
  let nodeCount = 1
  let textLength = 0

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || current.depth > 32 || ++nodeCount > 5_000 || !isRecord(current.node)) return false
    const { node, parent, depth } = current
    if (typeof node.type !== 'string') return false
    const type = node.type
    if (
      ![
        'paragraph',
        'heading',
        'bulletList',
        'orderedList',
        'listItem',
        'blockquote',
        'codeBlock',
        'horizontalRule',
        'text',
        'hardBreak',
      ].includes(type)
    )
      return false
    if (
      (parent === 'doc' && !blockTypes.has(type)) ||
      ((parent === 'paragraph' || parent === 'heading') && !inlineTypes.has(type))
    )
      return false
    if ((parent === 'bulletList' || parent === 'orderedList') && type !== 'listItem') return false
    if (parent === 'listItem' && !blockTypes.has(type)) return false
    if (parent === 'blockquote' && !blockTypes.has(type)) return false
    if (parent === 'codeBlock' && type !== 'text') return false
    if (
      parent !== 'doc' &&
      parent !== 'bulletList' &&
      parent !== 'orderedList' &&
      parent !== 'listItem' &&
      parent !== 'blockquote' &&
      parent !== 'codeBlock' &&
      parent !== 'paragraph' &&
      parent !== 'heading'
    )
      return false

    if (type === 'text') {
      if (typeof node.text !== 'string' || node.text.length === 0 || node.content !== undefined) return false
      textLength += node.text.length
      if (textLength > 100_000) return false
    } else if (node.text !== undefined) {
      return false
    }

    if (node.attrs !== undefined) {
      if (!isRecord(node.attrs)) return false
      const attrs = node.attrs
      if (type === 'heading' && !(attrs.level === 1 || attrs.level === 2 || attrs.level === 3)) return false
      if (type === 'orderedList') {
        if (attrs.start !== undefined && (!Number.isInteger(attrs.start) || Number(attrs.start) < 1)) return false
        if (
          attrs.type !== undefined &&
          attrs.type !== null &&
          (typeof attrs.type !== 'string' || !['1', 'a', 'A', 'i', 'I'].includes(attrs.type))
        )
          return false
      }
      if (
        type === 'codeBlock' &&
        attrs.language !== undefined &&
        attrs.language !== null &&
        (typeof attrs.language !== 'string' || attrs.language.length > 40)
      )
        return false
      const allowedAttrs =
        type === 'heading'
          ? ['level']
          : type === 'orderedList'
            ? ['start', 'type']
            : type === 'codeBlock'
              ? ['language']
              : []
      if (Object.keys(attrs).some((key) => !allowedAttrs.includes(key))) return false
    } else if (type === 'heading') {
      // Tiptap's default heading level is one when the attribute is omitted.
    }

    if (node.marks !== undefined) {
      if (type !== 'text' || !Array.isArray(node.marks) || node.marks.length > 8) return false
      for (const mark of node.marks) {
        if (!isRecord(mark) || typeof mark.type !== 'string' || !markTypes.has(mark.type)) return false
        if (mark.attrs !== undefined) {
          if (mark.type !== 'link' || !isRecord(mark.attrs)) return false
          const { href, target, rel, class: className, title } = mark.attrs
          if (typeof href !== 'string' || href.length > 2_048 || !isSafeHref(href)) return false
          if (target !== undefined && target !== '_blank' && target !== '_self') return false
          if (rel !== undefined && rel !== null && rel !== 'noopener noreferrer nofollow') return false
          if (className !== undefined && className !== null) return false
          if (title !== undefined && title !== null && (typeof title !== 'string' || title.length > 255)) return false
          if (Object.keys(mark.attrs).some((key) => !['href', 'target', 'rel', 'class', 'title'].includes(key)))
            return false
        } else if (mark.type === 'link') {
          return false
        }
      }
    }

    if (node.content !== undefined) {
      if (!Array.isArray(node.content) || node.content.length > 1_000) return false
      if (type === 'horizontalRule' || type === 'hardBreak' || type === 'text') return false
      for (const child of node.content) stack.push({ node: child, depth: depth + 1, parent: type })
    } else if (
      ['doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock'].includes(type)
    ) {
      if (type === 'paragraph' || type === 'heading' || type === 'bulletList' || type === 'orderedList') continue
      return false
    }
  }

  return true
}

export const richTextDocumentSchema = z.custom<RichTextDocument>(isRichTextDocument, {
  message: 'Note content is invalid.',
})

export const noteSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  ticketId: z.string().uuid(),
  title: z.string().min(1).max(160),
  content: richTextDocumentSchema,
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
  createdByUserId: z.string().min(1),
  updatedByUserId: z.string().min(1),
  deletedByUserId: z.string().min(1).nullable(),
  ticket: z.object({
    otNumber: z.number().int().positive(),
    title: z.string().min(1).max(200),
    status: z.enum(['requested', 'analysis', 'development', 'review', 'correction', 'delivered', 'production']),
    clientId: z.string().uuid().nullable(),
    clientName: z.string().nullable(),
  }),
})

const noteFieldsSchema = {
  ticketId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  content: richTextDocumentSchema,
}

export const createNoteMutationSchema = z.object({
  id: z.string().uuid(),
  clientMutationId: z.string().uuid(),
  ...noteFieldsSchema,
})

export const updateNoteMutationSchema = z
  .object({
    ticketId: noteFieldsSchema.ticketId.optional(),
    title: noteFieldsSchema.title.optional(),
    content: noteFieldsSchema.content.optional(),
    expectedVersion: z.number().int().positive(),
    clientMutationId: z.string().uuid(),
  })
  .refine((input) => input.ticketId !== undefined || input.title !== undefined || input.content !== undefined)

export const deleteNoteMutationSchema = z.object({
  expectedVersion: z.number().int().positive(),
  clientMutationId: z.string().uuid(),
})

export const noteCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
})

export const noteListFiltersSchema = z.object({ ticketId: z.string().uuid().nullable() })

export const noteListSchema = z.object({
  notes: z.array(noteSchema).max(notePageSize),
  nextCursor: noteCursorSchema.nullable(),
})

export type Note = z.infer<typeof noteSchema>
export type NoteCursor = z.infer<typeof noteCursorSchema>
export type NoteListFilters = z.infer<typeof noteListFiltersSchema>
export type CreateNoteMutation = z.infer<typeof createNoteMutationSchema>
export type UpdateNoteMutation = z.infer<typeof updateNoteMutationSchema>
export type DeleteNoteMutation = z.infer<typeof deleteNoteMutationSchema>
