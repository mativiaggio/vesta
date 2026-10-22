import { ticketCursorSchema, type TicketCursor } from '../../../../packages/tickets/src/contract.js'

export function decodeTicketCursor(value: string | undefined): TicketCursor | null | 'invalid' {
  if (!value) return null
  if (value.length > 256) return 'invalid'
  try {
    const parsed = ticketCursorSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : 'invalid'
  } catch {
    return 'invalid'
  }
}
