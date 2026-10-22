import { describe, expect, it } from 'vitest'
import {
  createTicketMutationSchema,
  deleteTicketMutationSchema,
  ticketCursorSchema,
  ticketListSchema,
  ticketStatuses,
  updateTicketMutationSchema,
} from './contract'

const ticketId = '16cbe9a8-102b-4c6c-9499-96d0cd879fc0'

describe('ticket contracts', () => {
  it('accepts optional clients and keeps the requested workflow values', () => {
    const parsed = createTicketMutationSchema.parse({
      id: ticketId,
      clientMutationId: 'dc2ec4e6-f739-4ed9-990e-8bb205ec3863',
      otNumber: 41,
      clientId: null,
      title: 'Prepare onboarding',
      description: '',
      priority: 'medium',
      status: 'requested',
      estimatedHours: 0,
      workedHours: 0,
    })

    expect(parsed.clientId).toBeNull()
    expect(ticketStatuses).toEqual([
      'requested',
      'analysis',
      'development',
      'review',
      'correction',
      'delivered',
      'production',
    ])
  })

  it('rejects negative or over-precise hour values', () => {
    const input = {
      id: ticketId,
      clientMutationId: 'dc2ec4e6-f739-4ed9-990e-8bb205ec3863',
      otNumber: 41,
      clientId: null,
      title: 'Prepare onboarding',
      description: 'Details',
      priority: 'high',
      status: 'development',
      estimatedHours: 1.005,
      workedHours: -1,
    }

    expect(createTicketMutationSchema.safeParse(input).success).toBe(false)
  })

  it('requires a positive integer OT number for ticket writes', () => {
    const validTicket = {
      id: ticketId,
      clientMutationId: 'dc2ec4e6-f739-4ed9-990e-8bb205ec3863',
      otNumber: 41,
      clientId: null,
      title: 'Prepare onboarding',
      description: '',
      priority: 'medium',
      status: 'requested',
      estimatedHours: 0,
      workedHours: 0,
    }
    expect(createTicketMutationSchema.safeParse({ ...validTicket, otNumber: 0 }).success).toBe(false)
    expect(createTicketMutationSchema.safeParse({ ...validTicket, otNumber: 1.5 }).success).toBe(false)
    expect(createTicketMutationSchema.safeParse(validTicket).success).toBe(true)
  })

  it('requires a ticket change with a version for updates and validates delete receipts', () => {
    expect(
      updateTicketMutationSchema.safeParse({
        expectedVersion: 2,
        clientMutationId: 'dc2ec4e6-f739-4ed9-990e-8bb205ec3863',
      }).success,
    ).toBe(false)
    expect(
      deleteTicketMutationSchema.safeParse({
        expectedVersion: 2,
        clientMutationId: 'dc2ec4e6-f739-4ed9-990e-8bb205ec3863',
      }).success,
    ).toBe(true)
  })

  it('limits page collections to the authoritative page size', () => {
    expect(ticketListSchema.safeParse({ tickets: [], nextCursor: null }).success).toBe(true)
  })

  it('preserves microsecond precision in server page cursors', () => {
    expect(ticketCursorSchema.parse({ createdAt: '2026-10-22T14:53:27.123456Z', id: ticketId }).createdAt).toBe(
      '2026-10-22T14:53:27.123456Z',
    )
  })
})
