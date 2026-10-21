import { Hono, type Context } from 'hono'
import { serverConfig } from '../config.js'
import { requireSession, type AuthEnvironment } from '../middleware/require-session.js'
import { createRequireTrustedMutationOrigin } from '../middleware/require-trusted-mutation-origin.js'
import { createRequireWorkspaceMutationRateLimit } from '../middleware/require-workspace-mutation-rate-limit.js'
import type { MutationRateLimiter } from '../rate-limit/mutation-rate-limiter.js'
import { decodeClientCursor } from './client-cursor.js'
import { clientSearchSchema } from '../../../../packages/clients/src/contract.js'
import {
  createWorkspaceClient,
  deleteWorkspaceClient,
  listWorkspaceClients,
  listWorkspaceClientsForSync,
  updateWorkspaceClient,
} from './client-service.js'

function routeParam(context: Context<AuthEnvironment>, name: string): string {
  return context.req.param(name) ?? ''
}

export function createClientRoutes(rateLimiter: MutationRateLimiter) {
  const routes = new Hono<AuthEnvironment>()
  routes.use('*', createRequireTrustedMutationOrigin(serverConfig.trustedOrigins))
  routes.use('*', requireSession)
  routes.use('*', createRequireWorkspaceMutationRateLimit(rateLimiter))

  routes.get('/', async (context) => {
    const { user } = context.get('authSession')
    const cursor = decodeClientCursor(context.req.query('cursor'))
    if (cursor === 'invalid') return context.json({ error: 'Invalid client page.' }, 400)
    const search = clientSearchSchema.safeParse(context.req.query('search') ?? '')
    if (!search.success) return context.json({ error: 'Invalid client search.' }, 400)
    const result = await listWorkspaceClients(user.id, routeParam(context, 'workspaceId'), cursor, search.data)
    if ('kind' in result && result.kind === 'not-found') return context.json({ error: 'Workspace not found.' }, 404)
    return context.json(result)
  })

  routes.get('/sync', async (context) => {
    const { user } = context.get('authSession')
    const cursor = decodeClientCursor(context.req.query('cursor'))
    if (cursor === 'invalid') return context.json({ error: 'Invalid client sync cursor.' }, 400)
    const result = await listWorkspaceClientsForSync(user.id, routeParam(context, 'workspaceId'), cursor)
    if ('kind' in result && result.kind === 'not-found') return context.json({ error: 'Workspace not found.' }, 404)
    return context.json(result)
  })

  routes.post('/', async (context) => {
    const { user } = context.get('authSession')
    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: 'Invalid request body.' }, 400)
    }
    const result = await createWorkspaceClient(user.id, routeParam(context, 'workspaceId'), body)
    if (result.kind === 'invalid') return context.json({ error: 'Invalid client details.' }, 400)
    if (result.kind === 'not-found') return context.json({ error: 'Workspace not found.' }, 404)
    if (result.kind === 'conflict')
      return context.json({ error: 'Client code or mutation conflicts with existing data.' }, 409)
    if (result.kind === 'capacity') {
      context.header('Retry-After', '3600')
      return context.json({ error: 'Client synchronization is temporarily at capacity.' }, 503)
    }
    return context.json({ client: result.client }, 201)
  })

  routes.patch('/:clientId', async (context) => {
    const { user } = context.get('authSession')
    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: 'Invalid request body.' }, 400)
    }
    const result = await updateWorkspaceClient(
      user.id,
      routeParam(context, 'workspaceId'),
      routeParam(context, 'clientId'),
      body,
    )
    if (result.kind === 'invalid') return context.json({ error: 'Invalid client details.' }, 400)
    if (result.kind === 'not-found') return context.json({ error: 'Client not found.' }, 404)
    if (result.kind === 'conflict')
      return context.json({ error: 'Client changed elsewhere or the code is already in use.' }, 409)
    if (result.kind === 'capacity') {
      context.header('Retry-After', '3600')
      return context.json({ error: 'Client synchronization is temporarily at capacity.' }, 503)
    }
    return context.json({ client: result.client })
  })

  routes.delete('/:clientId', async (context) => {
    const { user } = context.get('authSession')
    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: 'Invalid request body.' }, 400)
    }
    const result = await deleteWorkspaceClient(
      user.id,
      routeParam(context, 'workspaceId'),
      routeParam(context, 'clientId'),
      body,
    )
    if (result.kind === 'invalid') return context.json({ error: 'Invalid client deletion.' }, 400)
    if (result.kind === 'not-found') return context.json({ error: 'Client not found.' }, 404)
    if (result.kind === 'conflict') return context.json({ error: 'Client changed elsewhere.' }, 409)
    if (result.kind === 'capacity') {
      context.header('Retry-After', '3600')
      return context.json({ error: 'Client synchronization is temporarily at capacity.' }, 503)
    }
    return context.json({ deletedAt: result.deletedAt })
  })

  return routes
}
