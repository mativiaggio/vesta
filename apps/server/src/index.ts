import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { Hono } from 'hono'
import { auth, closeAuthDatabase } from './auth.js'
import { serverConfig } from './config.js'
import { requireSession, type AuthEnvironment } from './middleware/require-session.js'

const app = new Hono<AuthEnvironment>()

app.get('/health', (context) => context.json({ status: 'ok' }))

app.use('/api/*', cors({
  origin: serverConfig.trustedOrigins,
  credentials: true,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.get('/api/me', requireSession, (context) => {
  const { user } = context.get('authSession')
  return context.json({ user: { id: user.id, name: user.name, email: user.email } })
})

app.all('/api/auth/*', (context) => auth.handler(context.req.raw))

const server = serve({ fetch: app.fetch, port: serverConfig.port }, (info) => {
  process.stdout.write(`Vesta API listening on http://localhost:${info.port}\n`)
})

async function shutdown(): Promise<void> {
  server.close()
  await closeAuthDatabase()
}

process.once('SIGINT', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })
