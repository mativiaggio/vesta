import { createMiddleware } from 'hono/factory'
import type { MutationRateLimiter } from '../rate-limit/mutation-rate-limiter.js'
import type { AuthEnvironment } from './require-session.js'

const policies = [
  { suffix: 'hour', windowMs: 60 * 60 * 1000, max: 120 },
  { suffix: 'day', windowMs: 24 * 60 * 60 * 1000, max: 300 },
] as const

export function createRequireWorkspaceMutationRateLimit(rateLimiter: MutationRateLimiter) {
  return createMiddleware<AuthEnvironment>(async (context, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(context.req.method.toUpperCase())) {
      await next()
      return
    }

    const { user } = context.get('authSession')
    try {
      const decision = await rateLimiter.consume(`workspace-mutation:${user.id}`, policies)
      if (!decision.allowed) {
        context.header('Retry-After', String(decision.retryAfterSeconds))
        return context.json({ error: 'Workspace mutation rate limit exceeded.' }, 429)
      }
    } catch {
      return context.json({ error: 'Workspace mutation protection is temporarily unavailable.' }, 503)
    }

    await next()
  })
}
