import { describe, expect, it } from 'vitest'
import { createPasswordResetContent } from './password-reset-content.js'

describe('password reset email content', () => {
  it('renders Spanish copy when requested', () => {
    const content = createPasswordResetContent({
      email: 'alex@example.com',
      resetUrl: 'https://vesta.example/reset?token=secret',
      language: 'es',
    })

    expect(content.subject).toBe('Restablece tu contraseña de Vesta')
    expect(content.text).toContain('Vence en una hora')
  })

  it('escapes the reset URL in HTML', () => {
    const content = createPasswordResetContent({
      email: 'alex@example.com',
      resetUrl: 'https://vesta.example/reset?a=1&b="unsafe"',
      language: 'en',
    })

    expect(content.html).toContain('a=1&amp;b=&quot;unsafe&quot;')
  })
})
