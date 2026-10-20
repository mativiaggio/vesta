import { createMiddleware } from 'hono/factory'
import { auth } from '../auth.js'

type AuthSession = typeof auth.$Infer.Session

export type AuthEnvironment = {
  Variables: {
    authSession: AuthSession
  }
}

export const requireSession = createMiddleware<AuthEnvironment>(async (context, next) => {
  const session = await auth.api.getSession({ headers: context.req.raw.headers })

  if (!session) return context.json({ error: 'Unauthorized' }, 401)

  context.set('authSession', session)
  await next()
})
