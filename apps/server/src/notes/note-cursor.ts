import { noteCursorSchema, type NoteCursor } from '../../../../packages/notes/src/contract.js'

export function decodeNoteCursor(value: string | undefined): NoteCursor | null | 'invalid' {
  if (!value) return null
  if (value.length > 256) return 'invalid'
  try {
    const parsed = noteCursorSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : 'invalid'
  } catch {
    return 'invalid'
  }
}
