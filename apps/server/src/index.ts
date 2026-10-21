import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { Hono } from 'hono'
import { auth, closeAuthDatabase } from './auth.js'
import { serverConfig } from './config.js'
import { startSyncReceiptRetention } from './maintenance/sync-receipt-retention.js'
import { requireSession, type AuthEnvironment } from './middleware/require-session.js'
import { PostgresMutationRateLimiter } from './rate-limit/postgres-mutation-rate-limiter.js'
import { createWorkspaceRoutes } from './workspaces/routes.js'
import { createClientRoutes } from './clients/routes.js'

const app = new Hono<AuthEnvironment>()

app.get('/health', (context) => context.json({ status: 'ok' }))

app.use(
  '/api/*',
  cors({
    origin: serverConfig.trustedOrigins,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Vesta-Language'],
  }),
)

app.get('/api/me', requireSession, (context) => {
  const { user } = context.get('authSession')
  return context.json({ user: { id: user.id, name: user.name, email: user.email } })
})

app.route('/api/workspaces', createWorkspaceRoutes(new PostgresMutationRateLimiter()))
app.route('/api/workspaces/:workspaceId/clients', createClientRoutes(new PostgresMutationRateLimiter()))

app.all('/api/auth/*', (context) => auth.handler(context.req.raw))

const server = serve({ fetch: app.fetch, port: serverConfig.port }, (info) => {
  process.stdout.write(`Vesta API listening on http://localhost:${info.port}\n`)
})
const stopSyncReceiptRetention = startSyncReceiptRetention()

async function shutdown(): Promise<void> {
  stopSyncReceiptRetention()
  server.close()
  await closeAuthDatabase()
}

process.once('SIGINT', () => {
  void shutdown()
})
process.once('SIGTERM', () => {
  void shutdown()
})
