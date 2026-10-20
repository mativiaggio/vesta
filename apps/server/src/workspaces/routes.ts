import { Hono } from 'hono'
import { requireSession, type AuthEnvironment } from '../middleware/require-session.js'
import { activateWorkspace, createWorkspace, listWorkspaces } from './application/workspace-service.js'

export const workspaceRoutes = new Hono<AuthEnvironment>()

workspaceRoutes.use('*', requireSession)

workspaceRoutes.get('/', async (context) => {
  const { user } = context.get('authSession')
  const rawOffset = context.req.query('offset') ?? '0'
  const offset = Number(rawOffset)
  if (!Number.isSafeInteger(offset) || offset < 0) return context.json({ error: 'Invalid workspace page.' }, 400)

  return context.json(await listWorkspaces(user.id, offset))
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
  return context.json({ workspace: result.workspace }, 201)
})

workspaceRoutes.post('/:workspaceId/activate', async (context) => {
  const { user } = context.get('authSession')
  const activated = await activateWorkspace(user.id, context.req.param('workspaceId'))
  if (!activated) return context.json({ error: 'Workspace not found.' }, 404)

  return context.json({ ok: true })
})
