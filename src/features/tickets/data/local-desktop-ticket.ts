import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import {
  ticketListSchema,
  type CreateTicketMutation,
  type TicketCursor,
  type TicketListFilters,
  type UpdateTicketMutation,
} from '../../../../packages/tickets/src/contract'

export type LocalDesktopTicketPage = z.infer<typeof ticketListSchema>

async function invokeTicketPage(command: string, args?: Record<string, unknown>): Promise<LocalDesktopTicketPage> {
  const result: unknown = await invoke(command, args)
  return ticketListSchema.parse(result)
}

export function loadLocalDesktopTickets(workspaceId: string, cursor: TicketCursor | null, filters: TicketListFilters) {
  return invokeTicketPage('get_local_tickets', {
    workspaceId,
    cursor,
    search: filters.search,
    status: filters.status,
    priority: filters.priority,
  })
}

export function loadLocalDesktopTicketsForSync(workspaceId: string, cursor: TicketCursor | null) {
  return invokeTicketPage('get_local_tickets_for_sync', { workspaceId, cursor })
}

export async function getNextLocalDesktopTicketOtNumber(workspaceId: string): Promise<number> {
  const result: unknown = await invoke('get_next_local_ticket_ot_number', { workspaceId })
  return z.number().int().min(1).max(2_147_483_647).parse(result)
}

export function createLocalDesktopTicket(
  input: Pick<
    CreateTicketMutation,
    'id' | 'otNumber' | 'clientId' | 'title' | 'description' | 'priority' | 'status' | 'estimatedHours' | 'workedHours'
  > & {
    workspaceId: string
  },
) {
  return invokeTicketPage('create_local_ticket', { input })
}

export function updateLocalDesktopTicket(
  workspaceId: string,
  ticketId: string,
  input: Omit<UpdateTicketMutation, 'clientMutationId'>,
  cursor: TicketCursor | null,
  filters: TicketListFilters,
) {
  return invokeTicketPage('update_local_ticket', {
    workspaceId,
    ticketId,
    input,
    pageQuery: {
      cursor,
      search: filters.search,
      status: filters.status,
      priority: filters.priority,
    },
  })
}

export async function deleteLocalDesktopTicket(workspaceId: string, ticketId: string, expectedVersion: number) {
  const result: unknown = await invoke('delete_local_ticket', { workspaceId, ticketId, expectedVersion })
  return z.object({ deletedAt: z.string().datetime() }).parse(result)
}
