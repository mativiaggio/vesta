import { Hono, type Context } from 'hono'
import { noteListFiltersSchema } from '../../../../packages/notes/src/contract.js'
import { serverConfig } from '../config.js'
import type { BlobStorage } from '../attachments/blob-storage.js'
import { createRequireTrustedMutationOrigin } from '../middleware/require-trusted-mutation-origin.js'
import { createRequireWorkspaceMutationRateLimit } from '../middleware/require-workspace-mutation-rate-limit.js'
import { requireSession, type AuthEnvironment } from '../middleware/require-session.js'
import type { MutationRateLimiter } from '../rate-limit/mutation-rate-limiter.js'
import { decodeNoteCursor } from './note-cursor.js'
import {
  createWorkspaceNote,
  deleteWorkspaceNote,
  getWorkspaceNote,
  listWorkspaceNotes,
  listWorkspaceNotesForSync,
  updateWorkspaceNote,
} from './note-service.js'
import { createNoteAttachmentRoutes } from './note-attachment-routes.js'

function routeParam(context: Context<AuthEnvironment>, name: string): string {
  return context.req.param(name) ?? ''
}

export function createNoteRoutes(rateLimiter: MutationRateLimiter, attachmentStorage: BlobStorage) {
  const routes = new Hono<AuthEnvironment>()
  routes.use('*', createRequireTrustedMutationOrigin(serverConfig.trustedOrigins))
  routes.use('*', requireSession)
  routes.use('*', createRequireWorkspaceMutationRateLimit(rateLimiter))

  routes.get('/', async (context) => {
    const { user } = context.get('authSession')
    const cursor = decodeNoteCursor(context.req.query('cursor'))
    if (cursor === 'invalid') return context.json({ error: 'Invalid note page.' }, 400)
    const rawTicketId = context.req.query('ticketId')
    const filters = noteListFiltersSchema.safeParse({ ticketId: rawTicketId || null })
    if (!filters.success) return context.json({ error: 'Invalid note filters.' }, 400)
    const result = await listWorkspaceNotes(user.id, routeParam(context, 'workspaceId'), cursor, filters.data)
    if ('kind' in result && result.kind === 'not-found') return context.json({ error: 'Workspace not found.' }, 404)
    if ('kind' in result && result.kind === 'invalid') return context.json({ error: 'Invalid note filters.' }, 400)
    return context.json(result)
  })

  routes.get('/sync', async (context) => {
    const { user } = context.get('authSession')
    const cursor = decodeNoteCursor(context.req.query('cursor'))
    if (cursor === 'invalid') return context.json({ error: 'Invalid note sync cursor.' }, 400)
    const result = await listWorkspaceNotesForSync(user.id, routeParam(context, 'workspaceId'), cursor)
    if ('kind' in result && result.kind === 'not-found') return context.json({ error: 'Workspace not found.' }, 404)
    return context.json(result)
  })

  routes.get('/:noteId', async (context) => {
    const { user } = context.get('authSession')
    const result = await getWorkspaceNote(user.id, routeParam(context, 'workspaceId'), routeParam(context, 'noteId'))
    if (result.kind === 'not-found') return context.json({ error: 'Note not found.' }, 404)
    return context.json({ note: result.note })
  })

  routes.post('/', async (context) => {
    const { user } = context.get('authSession')
    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: 'Invalid request body.' }, 400)
    }
    const result = await createWorkspaceNote(user.id, routeParam(context, 'workspaceId'), body)
    if (result.kind === 'invalid') return context.json({ error: 'Invalid note details.' }, 400)
    if (result.kind === 'not-found') return context.json({ error: 'Workspace not found.' }, 404)
    if (result.kind === 'invalid-ticket') return context.json({ error: 'The selected ticket is not available.' }, 400)
    if (result.kind === 'conflict') {
      return context.json({ error: 'Note or mutation conflicts with existing data.', code: 'mutation-conflict' }, 409)
    }
    if (result.kind === 'capacity') {
      context.header('Retry-After', '3600')
      return context.json({ error: 'Note synchronization is temporarily at capacity.' }, 503)
    }
    return context.json({ note: result.note }, 201)
  })

  routes.patch('/:noteId', async (context) => {
    const { user } = context.get('authSession')
    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: 'Invalid request body.' }, 400)
    }
    const result = await updateWorkspaceNote(
      user.id,
      routeParam(context, 'workspaceId'),
      routeParam(context, 'noteId'),
      body,
    )
    if (result.kind === 'invalid') return context.json({ error: 'Invalid note details.' }, 400)
    if (result.kind === 'not-found') return context.json({ error: 'Note not found.' }, 404)
    if (result.kind === 'invalid-ticket') return context.json({ error: 'The selected ticket is not available.' }, 400)
    if (result.kind === 'version-conflict') {
      return context.json({ error: 'This note changed on another device.', code: 'version-conflict' }, 409)
    }
    if (result.kind === 'conflict') {
      return context.json({ error: 'Mutation ID conflicts with an existing change.', code: 'mutation-conflict' }, 409)
    }
    if (result.kind === 'capacity') {
      context.header('Retry-After', '3600')
      return context.json({ error: 'Note synchronization is temporarily at capacity.' }, 503)
    }
    return context.json({ note: result.note })
  })

  routes.delete('/:noteId', async (context) => {
    const { user } = context.get('authSession')
    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: 'Invalid request body.' }, 400)
    }
    const result = await deleteWorkspaceNote(
      user.id,
      routeParam(context, 'workspaceId'),
      routeParam(context, 'noteId'),
      body,
    )
    if (result.kind === 'invalid') return context.json({ error: 'Invalid note deletion.' }, 400)
    if (result.kind === 'not-found') return context.json({ error: 'Note not found.' }, 404)
    if (result.kind === 'version-conflict') {
      return context.json({ error: 'This note changed on another device.', code: 'version-conflict' }, 409)
    }
    if (result.kind === 'conflict') {
      return context.json({ error: 'Mutation ID conflicts with an existing change.', code: 'mutation-conflict' }, 409)
    }
    if (result.kind === 'capacity') {
      context.header('Retry-After', '3600')
      return context.json({ error: 'Note synchronization is temporarily at capacity.' }, 503)
    }
    return context.json({ deletedAt: result.deletedAt })
  })

  routes.route('/:noteId/attachments', createNoteAttachmentRoutes(attachmentStorage))
  return routes
}
