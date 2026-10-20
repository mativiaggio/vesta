import { Hono } from 'hono'
import { serverConfig } from '../config.js'
import { requireSession, type AuthEnvironment } from '../middleware/require-session.js'
import { createRequireTrustedMutationOrigin } from '../middleware/require-trusted-mutation-origin.js'
import { createRequireWorkspaceMutationRateLimit } from '../middleware/require-workspace-mutation-rate-limit.js'
import type { MutationRateLimiter } from '../rate-limit/mutation-rate-limiter.js'
import { activateWorkspaceMutationSchema } from '../../../../packages/workspaces/src/contract.js'
import { decodeWorkspaceCursor } from './application/workspace-cursor.js'
import { activateWorkspace, createWorkspace, listWorkspaces } from './application/workspace-service.js'

export function createWorkspaceRoutes(rateLimiter: MutationRateLimiter) {
  const workspaceRoutes = new Hono<AuthEnvironment>()

  workspaceRoutes.use('*', createRequireTrustedMutationOrigin(serverConfig.trustedOrigins))
  workspaceRoutes.use('*', requireSession)
  workspaceRoutes.use('*', createRequireWorkspaceMutationRateLimit(rateLimiter))

  workspaceRoutes.get('/', async (context) => {
    const { user } = context.get('authSession')
    const cursor = decodeWorkspaceCursor(context.req.query('cursor'))
    if (cursor === 'invalid') return context.json({ error: 'Invalid workspace page.' }, 400)

    return context.json(await listWorkspaces(user.id, cursor))
  })

  workspaceRoutes.post('/', async (context) => {
    const { user } = context.get('authSession')
    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: 'Invalid request body.' }, 400)
    }

    const result = await createWorkspace(user.id, body)
    if (result.kind === 'invalid') return context.json({ error: 'Invalid workspace details.' }, 400)
    if (result.kind === 'conflict')
      return context.json({ error: 'Workspace mutation conflicts with existing data.' }, 409)
    if (result.kind === 'capacity') {
      context.header('Retry-After', '3600')
      return context.json({ error: 'Workspace synchronization is temporarily at capacity.' }, 503)
    }
    return context.json({ workspace: result.workspace }, 201)
  })

  workspaceRoutes.post('/:workspaceId/activate', async (context) => {
    const { user } = context.get('authSession')
    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: 'Invalid request body.' }, 400)
    }

    const parsed = activateWorkspaceMutationSchema.safeParse(body)
    if (!parsed.success) return context.json({ error: 'Invalid workspace activation.' }, 400)

    const result = await activateWorkspace(user.id, context.req.param('workspaceId'), parsed.data)
    if (result.kind === 'not-found') return context.json({ error: 'Workspace not found.' }, 404)
    if (result.kind === 'conflict')
      return context.json({ error: 'Workspace mutation conflicts with existing data.' }, 409)
    if (result.kind === 'capacity') {
      context.header('Retry-After', '3600')
      return context.json({ error: 'Workspace synchronization is temporarily at capacity.' }, 503)
    }

    return context.json({ activation: result.activation })
  })

  return workspaceRoutes
}
