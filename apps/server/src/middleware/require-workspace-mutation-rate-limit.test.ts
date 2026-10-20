import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { MutationRateLimiter } from '../rate-limit/mutation-rate-limiter.js'
import { createRequireWorkspaceMutationRateLimit } from './require-workspace-mutation-rate-limit.js'
import type { AuthEnvironment } from './require-session.js'

function createTestApp(rateLimiter: MutationRateLimiter) {
  const app = new Hono<AuthEnvironment>()
  app.use('*', async (context, next) => {
    context.set('authSession', {
      user: { id: 'user-1' },
      session: {},
    } as AuthEnvironment['Variables']['authSession'])
    await next()
  })
  app.use('*', createRequireWorkspaceMutationRateLimit(rateLimiter))
  app.get('/resource', (context) => context.json({ ok: true }))
  app.post('/resource', (context) => context.json({ ok: true }))
  return app
}

describe('workspace mutation rate limit', () => {
  it('does not consume capacity for safe reads', async () => {
    const consume = vi.fn<MutationRateLimiter['consume']>()
    const response = await createTestApp({ consume }).request('/resource')
    expect(response.status).toBe(200)
    expect(consume).not.toHaveBeenCalled()
  })

  it('enforces both the hourly and daily shared limits', async () => {
    const consume = vi.fn<MutationRateLimiter['consume']>().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    const response = await createTestApp({ consume }).request('/resource', { method: 'POST' })
    expect(response.status).toBe(200)
    expect(consume).toHaveBeenCalledTimes(1)
    expect(consume).toHaveBeenCalledWith('workspace-mutation:user-1', [
      { suffix: 'hour', windowMs: 60 * 60 * 1000, max: 120 },
      { suffix: 'day', windowMs: 24 * 60 * 60 * 1000, max: 300 },
    ])
  })

  it('returns 429 with retry guidance when a limit is exhausted', async () => {
    const consume = vi.fn<MutationRateLimiter['consume']>().mockResolvedValue({ allowed: false, retryAfterSeconds: 42 })
    const response = await createTestApp({ consume }).request('/resource', { method: 'POST' })
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('42')
  })

  it('fails closed when shared protection is unavailable', async () => {
    const consume = vi.fn<MutationRateLimiter['consume']>().mockRejectedValue(new Error('database unavailable'))
    const response = await createTestApp({ consume }).request('/resource', { method: 'POST' })
    expect(response.status).toBe(503)
  })
})
