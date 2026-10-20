import { describe, expect, it } from 'vitest'
import { readResetLink } from '../application/reset-link-state'

describe('password reset route state', () => {
  it('reads a reset token only while it is present in the URL', () => {
    expect(readResetLink('?token=reset-token')).toEqual({ token: 'reset-token', invalid: false })
    expect(readResetLink('')).toEqual({ token: null, invalid: false })
  })

  it('recognizes an invalid reset link', () => {
    expect(readResetLink('?error=INVALID_TOKEN')).toEqual({ token: null, invalid: true })
  })
})
