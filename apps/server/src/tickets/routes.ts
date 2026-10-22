import { Hono, type Context } from 'hono'
import { ticketListFiltersSchema } from '../../../../packages/tickets/src/contract.js'
import { serverConfig } from '../config.js'
import { requireSession, type AuthEnvironment } from '../middleware/require-session.js'
import { createRequireTrustedMutationOrigin } from '../middleware/require-trusted-mutation-origin.js'
import { createRequireWorkspaceMutationRateLimit } from '../middleware/require-workspace-mutation-rate-limit.js'
import type { MutationRateLimiter } from '../rate-limit/mutation-rate-limiter.js'
import type { BlobStorage } from '../attachments/blob-storage.js'
import { createTicketAttachmentRoutes } from '../attachments/routes.js'
import { decodeTicketCursor } from './ticket-cursor.js'
import {
  createWorkspaceTicket,
  deleteWorkspaceTicket,
  getWorkspaceTicket,
  getWorkspaceNextTicketOtNumber,
  listWorkspaceTickets,
  listWorkspaceTicketsForSync,
  updateWorkspaceTicket,
} from './ticket-service.js'

function routeParam(context: Context<AuthEnvironment>, name: string): string {
  return context.req.param(name) ?? ''
}

export function createTicketRoutes(rateLimiter: MutationRateLimiter, attachmentStorage: BlobStorage) {
  const routes = new Hono<AuthEnvironment>()
  routes.use('*', createRequireTrustedMutationOrigin(serverConfig.trustedOrigins))
  routes.use('*', requireSession)
  routes.use('*', createRequireWorkspaceMutationRateLimit(rateLimiter))

  routes.get('/', async (context) => {
    const { user } = context.get('authSession')
    const cursor = decodeTicketCursor(context.req.query('cursor'))
    if (cursor === 'invalid') return context.json({ error: 'Invalid ticket page.' }, 400)
    const filters = ticketListFiltersSchema.safeParse({
      status: context.req.query('status') ?? null,
      priority: context.req.query('priority') ?? null,
      search: context.req.query('search') ?? '',
    })
    if (!filters.success) return context.json({ error: 'Invalid ticket filters.' }, 400)
    const result = await listWorkspaceTickets(user.id, routeParam(context, 'workspaceId'), cursor, filters.data)
    if ('kind' in result && result.kind === 'not-found') return context.json({ error: 'Workspace not found.' }, 404)
    return context.json(result)
  })

  routes.get('/sync', async (context) => {
    const { user } = context.get('authSession')
    const cursor = decodeTicketCursor(context.req.query('cursor'))
    if (cursor === 'invalid') return context.json({ error: 'Invalid ticket sync cursor.' }, 400)
    const result = await listWorkspaceTicketsForSync(user.id, routeParam(context, 'workspaceId'), cursor)
    if ('kind' in result && result.kind === 'not-found') return context.json({ error: 'Workspace not found.' }, 404)
    return context.json(result)
  })

  routes.get('/next-number', async (context) => {
    const { user } = context.get('authSession')
    const result = await getWorkspaceNextTicketOtNumber(user.id, routeParam(context, 'workspaceId'))
    if (result.kind === 'not-found') return context.json({ error: 'Workspace not found.' }, 404)
    return context.json({ nextNumber: result.nextNumber })
  })

  routes.get('/:ticketId', async (context) => {
    const { user } = context.get('authSession')
    const result = await getWorkspaceTicket(
      user.id,
      routeParam(context, 'workspaceId'),
      routeParam(context, 'ticketId'),
    )
    if (result.kind === 'not-found') return context.json({ error: 'Ticket not found.' }, 404)
    return context.json({ ticket: result.ticket })
  })

  routes.post('/', async (context) => {
    const { user } = context.get('authSession')
    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: 'Invalid request body.' }, 400)
    }
    const result = await createWorkspaceTicket(user.id, routeParam(context, 'workspaceId'), body)
    if (result.kind === 'invalid') return context.json({ error: 'Invalid ticket details.' }, 400)
    if (result.kind === 'not-found') return context.json({ error: 'Workspace not found.' }, 404)
    if (result.kind === 'invalid-client') return context.json({ error: 'Ticket client is not available.' }, 400)
    if (result.kind === 'ot-number-conflict') {
      return context.json({ error: 'This OT number is already in use.', code: 'ot-number-conflict' }, 409)
    }
    if (result.kind === 'conflict') {
      return context.json({ error: 'Ticket or mutation conflicts with existing data.', code: 'mutation-conflict' }, 409)
    }
    if (result.kind === 'capacity') {
      context.header('Retry-After', '3600')
      return context.json({ error: 'Ticket synchronization is temporarily at capacity.' }, 503)
    }
    return context.json({ ticket: result.ticket }, 201)
  })

  routes.patch('/:ticketId', async (context) => {
    const { user } = context.get('authSession')
    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: 'Invalid request body.' }, 400)
    }
    const result = await updateWorkspaceTicket(
      user.id,
      routeParam(context, 'workspaceId'),
      routeParam(context, 'ticketId'),
      body,
    )
    if (result.kind === 'invalid') return context.json({ error: 'Invalid ticket details.' }, 400)
    if (result.kind === 'not-found') return context.json({ error: 'Ticket not found.' }, 404)
    if (result.kind === 'invalid-client') return context.json({ error: 'Ticket client is not available.' }, 400)
    if (result.kind === 'ot-number-conflict') {
      return context.json({ error: 'This OT number is already in use.', code: 'ot-number-conflict' }, 409)
    }
    if (result.kind === 'version-conflict') {
      return context.json({ error: 'Ticket changed elsewhere.', code: 'version-conflict' }, 409)
    }
    if (result.kind === 'conflict') {
      return context.json({ error: 'Mutation ID conflicts with an existing change.', code: 'mutation-conflict' }, 409)
    }
    if (result.kind === 'capacity') {
      context.header('Retry-After', '3600')
      return context.json({ error: 'Ticket synchronization is temporarily at capacity.' }, 503)
    }
    return context.json({ ticket: result.ticket })
  })

  routes.delete('/:ticketId', async (context) => {
    const { user } = context.get('authSession')
    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: 'Invalid request body.' }, 400)
    }
    const result = await deleteWorkspaceTicket(
      user.id,
      routeParam(context, 'workspaceId'),
      routeParam(context, 'ticketId'),
      body,
    )
    if (result.kind === 'invalid') return context.json({ error: 'Invalid ticket deletion.' }, 400)
    if (result.kind === 'not-found') return context.json({ error: 'Ticket not found.' }, 404)
    if (result.kind === 'version-conflict') {
      return context.json({ error: 'Ticket changed elsewhere.', code: 'version-conflict' }, 409)
    }
    if (result.kind === 'conflict') {
      return context.json({ error: 'Mutation ID conflicts with an existing change.', code: 'mutation-conflict' }, 409)
    }
    if (result.kind === 'capacity') {
      context.header('Retry-After', '3600')
      return context.json({ error: 'Ticket synchronization is temporarily at capacity.' }, 503)
    }
    return context.json({ deletedAt: result.deletedAt })
  })

  routes.route('/:ticketId/attachments', createTicketAttachmentRoutes(attachmentStorage))

  return routes
}
