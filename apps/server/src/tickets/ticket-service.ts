import {
  createTicketMutationSchema,
  deleteTicketMutationSchema,
  ticketListFiltersSchema,
  updateTicketMutationSchema,
} from '../../../../packages/tickets/src/contract.js'
import type { TicketCursor, TicketListFilters } from '../../../../packages/tickets/src/contract.js'
import {
  createTicketForWorkspace,
  deleteTicketForWorkspace,
  getNextTicketOtNumber,
  getTicketForWorkspace,
  listTicketsForWorkspace,
  listTicketsForWorkspaceForSync,
  updateTicketForWorkspace,
} from './ticket-repository.js'

export async function listWorkspaceTickets(
  userId: string,
  workspaceId: string,
  cursor: TicketCursor | null,
  input: unknown,
) {
  const filters = ticketListFiltersSchema.safeParse(input)
  if (!filters.success) return { kind: 'invalid' as const }
  return listTicketsForWorkspace(userId, workspaceId, cursor, filters.data satisfies TicketListFilters)
}

export async function listWorkspaceTicketsForSync(userId: string, workspaceId: string, cursor: TicketCursor | null) {
  return listTicketsForWorkspaceForSync(userId, workspaceId, cursor)
}

export function getWorkspaceNextTicketOtNumber(userId: string, workspaceId: string) {
  return getNextTicketOtNumber(userId, workspaceId)
}

export function getWorkspaceTicket(userId: string, workspaceId: string, ticketId: string) {
  return getTicketForWorkspace(userId, workspaceId, ticketId)
}

export async function createWorkspaceTicket(userId: string, workspaceId: string, input: unknown) {
  const parsed = createTicketMutationSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid' as const }
  return createTicketForWorkspace(userId, workspaceId, parsed.data)
}

export async function updateWorkspaceTicket(userId: string, workspaceId: string, ticketId: string, input: unknown) {
  const parsed = updateTicketMutationSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid' as const }
  return updateTicketForWorkspace(userId, workspaceId, ticketId, parsed.data)
}

export async function deleteWorkspaceTicket(userId: string, workspaceId: string, ticketId: string, input: unknown) {
  const parsed = deleteTicketMutationSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid' as const }
  return deleteTicketForWorkspace(userId, workspaceId, ticketId, parsed.data)
}
