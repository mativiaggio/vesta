import { clientCursorSchema, type ClientCursor } from '../../../../packages/clients/src/contract.js'

export function decodeClientCursor(value: string | undefined): ClientCursor | null | 'invalid' {
  if (!value) return null
  if (value.length > 256) return 'invalid'
  try {
    const parsed = clientCursorSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : 'invalid'
  } catch {
    return 'invalid'
  }
}
