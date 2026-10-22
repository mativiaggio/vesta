import {
  ticketStatuses,
  type Ticket,
  type TicketCursor,
  type TicketStatus,
} from '../../../../packages/tickets/src/contract'
import { loadLocalTicketPage } from '../data/ticket-local-store'
import { loadLocalDesktopTickets } from '../data/local-desktop-ticket'

const unfilteredPage = { status: null, priority: null, search: '' } as const

export type TicketActivityKind = 'created' | 'codingFinished' | 'production'

export type TicketActivity = {
  key: string
  ticketId: string
  otNumber: number
  title: string
  kind: TicketActivityKind
  occurredAt: string
}

export type TicketOverview = {
  ticketCount: number
  openTicketCount: number
  productionTicketCount: number
  estimatedOpenHours: number
  workedOpenHours: number
  statusCounts: Record<TicketStatus, number>
  activity: TicketActivity[]
  hasCompleteReplica: boolean
}

export type TicketOverviewStorageMode = 'server' | 'local'

type TicketPage = {
  tickets: Ticket[]
  nextCursor: TicketCursor | null
  hasCompleteReplica?: boolean
}

type TicketOverviewAccumulator = {
  ticketCount: number
  openTicketCount: number
  productionTicketCount: number
  estimatedOpenHours: number
  workedOpenHours: number
  statusCounts: Record<TicketStatus, number>
  activity: TicketActivity[]
}

function createAccumulator(): TicketOverviewAccumulator {
  return {
    ticketCount: 0,
    openTicketCount: 0,
    productionTicketCount: 0,
    estimatedOpenHours: 0,
    workedOpenHours: 0,
    statusCounts: Object.fromEntries(ticketStatuses.map((status) => [status, 0])) as Record<TicketStatus, number>,
    activity: [],
  }
}

function addTicket(accumulator: TicketOverviewAccumulator, ticket: Ticket): void {
  accumulator.ticketCount += 1
  accumulator.statusCounts[ticket.status] += 1
  const isOpen = ticket.status !== 'delivered' && ticket.status !== 'production'
  if (isOpen) {
    accumulator.openTicketCount += 1
    accumulator.estimatedOpenHours += ticket.estimatedHours
    accumulator.workedOpenHours += ticket.workedHours
  }
  if (ticket.status === 'production') accumulator.productionTicketCount += 1

  accumulator.activity.push({
    key: `${ticket.id}:created`,
    ticketId: ticket.id,
    otNumber: ticket.otNumber,
    title: ticket.title,
    kind: 'created',
    occurredAt: ticket.createdAt,
  })
  if (ticket.codingFinishedAt) {
    accumulator.activity.push({
      key: `${ticket.id}:coding-finished`,
      ticketId: ticket.id,
      otNumber: ticket.otNumber,
      title: ticket.title,
      kind: 'codingFinished',
      occurredAt: ticket.codingFinishedAt,
    })
  }
  if (ticket.productionAt) {
    accumulator.activity.push({
      key: `${ticket.id}:production`,
      ticketId: ticket.id,
      otNumber: ticket.otNumber,
      title: ticket.title,
      kind: 'production',
      occurredAt: ticket.productionAt,
    })
  }
}

function finishAccumulator(accumulator: TicketOverviewAccumulator, hasCompleteReplica: boolean): TicketOverview {
  return {
    ...accumulator,
    estimatedOpenHours: roundHours(accumulator.estimatedOpenHours),
    workedOpenHours: roundHours(accumulator.workedOpenHours),
    hasCompleteReplica,
  }
}

export function summarizeTickets(tickets: readonly Ticket[], hasCompleteReplica: boolean): TicketOverview {
  const accumulator = createAccumulator()
  for (const ticket of tickets) addTicket(accumulator, ticket)
  return finishAccumulator(accumulator, hasCompleteReplica)
}

function roundHours(hours: number): number {
  return Math.round(hours * 100) / 100
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Ticket overview load was cancelled.')
}

export async function loadTicketOverview(
  userId: string,
  workspaceId: string,
  storageMode: TicketOverviewStorageMode,
  signal?: AbortSignal,
): Promise<TicketOverview> {
  let cursor: TicketCursor | null = null
  const accumulator = createAccumulator()
  let hasCompleteReplica = storageMode === 'local'
  let isFirstPage = true

  do {
    ensureNotAborted(signal)
    const page: TicketPage =
      storageMode === 'local'
        ? await loadLocalDesktopTickets(workspaceId, cursor, unfilteredPage)
        : await loadLocalTicketPage(userId, workspaceId, cursor, unfilteredPage)
    if (isFirstPage && storageMode === 'server') hasCompleteReplica = Boolean(page.hasCompleteReplica)
    for (const ticket of page.tickets) {
      if (ticket.deletedAt !== null) throw new Error('The active ticket page returned a deleted record.')
      addTicket(accumulator, ticket)
    }
    cursor = page.nextCursor
    isFirstPage = false
  } while (cursor)

  ensureNotAborted(signal)
  return finishAccumulator(accumulator, hasCompleteReplica)
}

export async function refreshTicketOverviewReplica(
  userId: string,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<void> {
  const { refreshTicketsFromServer } = await import('./ticket-sync')
  await refreshTicketsFromServer(userId, workspaceId, signal)
}
