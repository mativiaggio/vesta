import { describe, expect, it } from 'vitest'
import { decodeClientCursor } from './client-cursor.js'

describe('client page cursors', () => {
  it('accepts a validated JSON cursor from the query string', () => {
    const cursor = {
      createdAt: '2026-10-21T12:00:00.000Z',
      id: '9fcd84af-2f30-4cf8-8c57-ae181b4b4e09',
    }

    expect(decodeClientCursor(JSON.stringify(cursor))).toEqual(cursor)
    expect(decodeClientCursor(undefined)).toBeNull()
  })

  it.each(['not-json', JSON.stringify({ createdAt: 'invalid', id: 'invalid' }), 'x'.repeat(257)])(
    'rejects invalid or oversized cursors',
    (cursor) => {
      expect(decodeClientCursor(cursor)).toBe('invalid')
    },
  )
})
