import { Readable } from 'node:stream'
import { Hono, type Context } from 'hono'
import { noteAttachmentCursorSchema } from '../../../../packages/notes/src/attachment-contract.js'
import type { AuthEnvironment } from '../middleware/require-session.js'
import type { BlobStorage } from '../attachments/blob-storage.js'
import {
  NoteAttachmentUploadError,
  getNoteAttachment,
  listNoteAttachments,
  softDeleteNoteAttachment,
  uploadNoteAttachment,
} from './note-attachment-service.js'

function routeParam(context: Context<AuthEnvironment>, name: string): string {
  return context.req.param(name) ?? ''
}

function toNodeReadable(body: ReadableStream<Uint8Array>): Readable {
  async function* readChunks() {
    const reader = body.getReader()
    let completed = false
    try {
      while (true) {
        const result = await reader.read()
        if (result.done) {
          completed = true
          return
        }
        yield Buffer.from(result.value)
      }
    } finally {
      if (!completed) await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }
  return Readable.from(readChunks())
}

function decodeCursor(value: string | undefined) {
  if (!value) return null
  if (value.length > 256) return 'invalid' as const
  try {
    const parsed = noteAttachmentCursorSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : ('invalid' as const)
  } catch {
    return 'invalid' as const
  }
}

function safeFileName(encodedName: string | undefined): string | null {
  if (!encodedName || encodedName.length > 4_096) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(encodedName)
  } catch {
    return null
  }
  const name = [...decoded.replace(/[\\/]/g, '_')]
    .filter((character) => {
      const point = character.codePointAt(0) ?? 0
      return point > 0x1f && (point < 0x7f || point > 0x9f)
    })
    .join('')
    .trim()
  return name.length > 0 && name.length <= 255 ? name : null
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'attachment'
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export function createNoteAttachmentRoutes(storage: BlobStorage) {
  const routes = new Hono<AuthEnvironment>()

  routes.get('/', async (context) => {
    const { user } = context.get('authSession')
    const cursor = decodeCursor(context.req.query('cursor'))
    if (cursor === 'invalid') return context.json({ error: 'Invalid attachment page.' }, 400)
    const result = await listNoteAttachments(
      user.id,
      routeParam(context, 'workspaceId'),
      routeParam(context, 'noteId'),
      cursor,
    )
    if (result.kind === 'not-found') return context.json({ error: 'Note not found.' }, 404)
    return context.json(result)
  })

  routes.post('/:attachmentId', async (context) => {
    const { user } = context.get('authSession')
    const attachmentId = routeParam(context, 'attachmentId')
    const fileName = safeFileName(context.req.header('x-vesta-file-name'))
    const sizeHeader = context.req.header('x-vesta-file-size')
    const sizeBytes = sizeHeader && /^\d{1,16}$/.test(sizeHeader) ? Number(sizeHeader) : Number.NaN
    const contentType = context.req.header('content-type')?.split(';')[0]?.trim() || 'application/octet-stream'
    const input = { id: attachmentId, fileName, contentType, sizeBytes }
    if (!fileName || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      void context.req.raw.body?.cancel().catch(() => undefined)
      return context.json({ error: 'Invalid attachment details.' }, 400)
    }
    const contentLength = context.req.header('content-length')
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) !== sizeBytes)) {
      void context.req.raw.body?.cancel().catch(() => undefined)
      return context.json({ error: 'Attachment size does not match its body.' }, 400)
    }
    const requestBody = context.req.raw.body
    if (!requestBody) return context.json({ error: 'Attachment body is missing.' }, 400)
    let result
    try {
      result = await uploadNoteAttachment(
        storage,
        user.id,
        routeParam(context, 'workspaceId'),
        routeParam(context, 'noteId'),
        input,
        () => toNodeReadable(requestBody),
      )
    } catch (error) {
      if (error instanceof NoteAttachmentUploadError && error.kind === 'size-mismatch') {
        return context.json({ error: 'Attachment size does not match its body.' }, 400)
      }
      if (error instanceof NoteAttachmentUploadError && error.kind === 'storage') {
        return context.json({ error: 'Attachment storage is unavailable.' }, 503)
      }
      return context.json({ error: 'Could not save the attachment.' }, 500)
    }
    if (result.kind === 'exists') void requestBody.cancel().catch(() => undefined)
    if (result.kind === 'invalid') return context.json({ error: 'Invalid attachment details.' }, 400)
    if (result.kind === 'not-found') return context.json({ error: 'Note not found.' }, 404)
    if (result.kind === 'conflict') {
      return context.json({ error: 'Attachment ID conflicts with an existing file.', code: 'attachment-conflict' }, 409)
    }
    return context.json({ attachment: result.attachment }, result.kind === 'created' ? 201 : 200)
  })

  routes.get('/:attachmentId/content', async (context) => {
    const { user } = context.get('authSession')
    const result = await getNoteAttachment(
      user.id,
      routeParam(context, 'workspaceId'),
      routeParam(context, 'noteId'),
      routeParam(context, 'attachmentId'),
    )
    if (result.kind === 'not-found') return context.json({ error: 'Attachment not found.' }, 404)
    try {
      const body = await storage.open(result.storageKey)
      return new Response(Readable.toWeb(body) as ReadableStream, {
        headers: {
          'Content-Type': result.attachment.contentType,
          'Content-Disposition': contentDisposition(result.attachment.fileName),
          'Content-Length': String(result.attachment.sizeBytes),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch {
      return context.json({ error: 'Attachment content is unavailable.' }, 503)
    }
  })

  routes.delete('/:attachmentId', async (context) => {
    const { user } = context.get('authSession')
    const result = await softDeleteNoteAttachment(
      user.id,
      routeParam(context, 'workspaceId'),
      routeParam(context, 'noteId'),
      routeParam(context, 'attachmentId'),
    )
    if (result.kind === 'not-found') return context.json({ error: 'Attachment not found.' }, 404)
    return context.body(null, 204)
  })

  return routes
}
