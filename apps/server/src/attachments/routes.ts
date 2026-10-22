import { Readable } from 'node:stream'
import { Hono, type Context } from 'hono'
import { ticketAttachmentCursorSchema } from '../../../../packages/tickets/src/attachment-contract.js'
import type { AuthEnvironment } from '../middleware/require-session.js'
import type { BlobStorage } from './blob-storage.js'
import {
  AttachmentUploadError,
  getTicketAttachment,
  listTicketAttachments,
  softDeleteTicketAttachment,
  uploadTicketAttachment,
} from './attachment-service.js'

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
    const parsed = ticketAttachmentCursorSchema.safeParse(JSON.parse(value))
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

export function createTicketAttachmentRoutes(storage: BlobStorage) {
  const routes = new Hono<AuthEnvironment>()

  routes.get('/', async (context) => {
    const { user } = context.get('authSession')
    const cursor = decodeCursor(context.req.query('cursor'))
    if (cursor === 'invalid') return context.json({ error: 'Invalid attachment page.' }, 400)
    const result = await listTicketAttachments(
      user.id,
      routeParam(context, 'workspaceId'),
      routeParam(context, 'ticketId'),
      cursor,
    )
    if (result.kind === 'not-found') return context.json({ error: 'Ticket not found.' }, 404)
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
      result = await uploadTicketAttachment(
        storage,
        user.id,
        routeParam(context, 'workspaceId'),
        routeParam(context, 'ticketId'),
        input,
        () => toNodeReadable(requestBody),
      )
    } catch (error) {
      if (error instanceof AttachmentUploadError && error.kind === 'size-mismatch') {
        return context.json({ error: 'Attachment size does not match its body.' }, 400)
      }
      if (error instanceof AttachmentUploadError && error.kind === 'storage') {
        return context.json({ error: 'Attachment storage is unavailable.' }, 503)
      }
      return context.json({ error: 'Could not save the attachment.' }, 500)
    }

    if (result.kind === 'exists') void requestBody.cancel().catch(() => undefined)

    if (result.kind === 'invalid') return context.json({ error: 'Invalid attachment details.' }, 400)
    if (result.kind === 'not-found') return context.json({ error: 'Ticket not found.' }, 404)
    if (result.kind === 'conflict') {
      return context.json({ error: 'Attachment ID conflicts with an existing file.', code: 'attachment-conflict' }, 409)
    }
    return context.json({ attachment: result.attachment }, result.kind === 'created' ? 201 : 200)
  })

  routes.get('/:attachmentId/content', async (context) => {
    const { user } = context.get('authSession')
    const result = await getTicketAttachment(
      user.id,
      routeParam(context, 'workspaceId'),
      routeParam(context, 'ticketId'),
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
    const result = await softDeleteTicketAttachment(
      user.id,
      routeParam(context, 'workspaceId'),
      routeParam(context, 'ticketId'),
      routeParam(context, 'attachmentId'),
    )
    if (result.kind === 'not-found') return context.json({ error: 'Attachment not found.' }, 404)
    return context.body(null, 204)
  })

  return routes
}
