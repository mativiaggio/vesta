import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createRequireTrustedMutationOrigin } from './require-trusted-mutation-origin.js'

function createTestApp() {
  const app = new Hono()
  app.use(
    '*',
    createRequireTrustedMutationOrigin(['https://app.vesta.test', 'http://tauri.localhost', 'tauri://localhost']),
  )
  app.get('/resource', (context) => context.json({ ok: true }))
  app.post('/resource', (context) => context.json({ ok: true }))
  return app
}

describe('createRequireTrustedMutationOrigin', () => {
  it('allows safe methods without an Origin header', async () => {
    const response = await createTestApp().request('/resource')
    expect(response.status).toBe(200)
  })

  it.each(['https://app.vesta.test', 'http://tauri.localhost', 'tauri://localhost'])(
    'allows a mutation from trusted origin %s',
    async (origin) => {
      const response = await createTestApp().request('/resource', { method: 'POST', headers: { Origin: origin } })
      expect(response.status).toBe(200)
    },
  )

  it('rejects a cross-site mutation even though the caller cannot read the response', async () => {
    const response = await createTestApp().request('/resource', {
      method: 'POST',
      headers: { Origin: 'https://attacker.example' },
    })
    expect(response.status).toBe(403)
  })

  it('rejects a mutation without an Origin header', async () => {
    const response = await createTestApp().request('/resource', { method: 'POST' })
    expect(response.status).toBe(403)
  })

  it('rejects origin-like values with a path', async () => {
    const response = await createTestApp().request('/resource', {
      method: 'POST',
      headers: { Origin: 'https://app.vesta.test/attacker' },
    })
    expect(response.status).toBe(403)
  })
})
