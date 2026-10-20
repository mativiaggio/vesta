import { describe, expect, it } from 'vitest'
import { decodeWorkspaceCursor, encodeWorkspaceCursor } from './workspace-cursor.js'

describe('workspace cursor', () => {
  it('round-trips a stable created-at and id tuple', () => {
    const cursor = { createdAt: new Date('2026-10-20T12:00:00.000Z'), id: '6d2c3f17-5c69-4d87-8ddc-caf630953885' }
    expect(decodeWorkspaceCursor(encodeWorkspaceCursor(cursor))).toEqual(cursor)
  })

  it.each(['not-base64', Buffer.from('{}').toString('base64url')])('rejects invalid cursor %s', (cursor) => {
    expect(decodeWorkspaceCursor(cursor)).toBe('invalid')
  })
})
