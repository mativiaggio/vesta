import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ticketSchema, type Ticket, type TicketStatus } from '../../../../packages/tickets/src/contract'
import {
  enqueueTicketCreation,
  markTicketReplicaHydrated,
  resetTicketLocalDatabaseForTests,
} from '../data/ticket-local-store'
import { loadTicketOverview, summarizeTickets } from './ticket-overview'

const workspaceId = '3f37eead-a33b-43b9-a980-ed7223e81123'
const createdAt = '2026-10-01T12:00:00.000Z'

function makeTicket(number: number, status: TicketStatus, changes: Partial<Ticket> = {}): Ticket {
  return ticketSchema.parse({
    id: `a22c2500-638b-4c5b-a883-${String(number).padStart(12, '0')}`,
    workspaceId,
    otNumber: number,
    clientId: null,
    clientName: null,
    title: `Work item ${number}`,
    description: '',
    priority: 'medium',
    status,
    estimatedHours: 3.5,
    workedHours: 2.25,
    codingFinishedAt: status === 'delivered' || status === 'production' ? '2026-10-04T12:00:00.000Z' : null,
    productionAt: status === 'production' ? '2026-10-05T12:00:00.000Z' : null,
    version: 1,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    createdByUserId: 'user-1',
    updatedByUserId: 'user-1',
    deletedByUserId: null,
    ...changes,
  })
}

describe('ticket overview summary', () => {
  beforeEach(resetTicketLocalDatabaseForTests)
  afterEach(resetTicketLocalDatabaseForTests)

  it('summarizes open workload, statuses, hours, and dated activity', () => {
    const tickets = [
      makeTicket(1, 'requested', { estimatedHours: 1.25, workedHours: 0.5 }),
      makeTicket(2, 'development', { estimatedHours: 4.5, workedHours: 3.75 }),
      makeTicket(3, 'delivered', { estimatedHours: 8, workedHours: 7 }),
      makeTicket(4, 'production', { estimatedHours: 6, workedHours: 5 }),
    ]

    expect(summarizeTickets(tickets, true)).toMatchObject({
      ticketCount: 4,
      openTicketCount: 2,
      productionTicketCount: 1,
      estimatedOpenHours: 5.75,
      workedOpenHours: 4.25,
      hasCompleteReplica: true,
      statusCounts: {
        requested: 1,
        development: 1,
        delivered: 1,
        production: 1,
      },
    })
    expect(summarizeTickets(tickets, true).activity).toHaveLength(7)
  })

  it('keeps incomplete replica status explicit when no tickets are present', () => {
    expect(summarizeTickets([], false)).toMatchObject({
      ticketCount: 0,
      openTicketCount: 0,
      estimatedOpenHours: 0,
      workedOpenHours: 0,
      hasCompleteReplica: false,
      activity: [],
    })
  })

  it('aggregates the entire replica across bounded 25-ticket pages', async () => {
    for (let number = 1; number <= 27; number += 1) {
      await enqueueTicketCreation(
        'overview-user',
        workspaceId,
        {
          otNumber: number,
          clientId: null,
          title: `Paged ticket ${number}`,
          description: '',
          priority: 'medium',
          status: 'development',
          estimatedHours: 1,
          workedHours: 0.5,
        },
        null,
      )
    }
    await markTicketReplicaHydrated('overview-user', workspaceId)

    const overview = await loadTicketOverview('overview-user', workspaceId, 'server')

    expect(overview).toMatchObject({
      ticketCount: 27,
      openTicketCount: 27,
      estimatedOpenHours: 27,
      workedOpenHours: 13.5,
      hasCompleteReplica: true,
      statusCounts: { development: 27 },
    })
    expect(overview.activity.some((activity) => activity.title === 'Paged ticket 27')).toBe(true)
  })
})
