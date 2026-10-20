import { z } from 'zod'

const cursorPayloadSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
})

export type WorkspaceCursor = {
  createdAt: Date
  id: string
}

export function encodeWorkspaceCursor(cursor: WorkspaceCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
  ).toString('base64url')
}

export function decodeWorkspaceCursor(value: string | undefined): WorkspaceCursor | null | 'invalid' {
  if (!value) return null

  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    const result = cursorPayloadSchema.safeParse(parsed)
    if (!result.success) return 'invalid'
    return { createdAt: new Date(result.data.createdAt), id: result.data.id }
  } catch {
    return 'invalid'
  }
}
