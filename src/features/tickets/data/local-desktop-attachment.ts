import { invoke } from '@tauri-apps/api/core'
import {
  ticketAttachmentPageSchema,
  ticketAttachmentSchema,
  type TicketAttachmentCursor,
} from '../../../../packages/tickets/src/attachment-contract'

export type LocalDesktopTicketAttachmentPage = ReturnType<typeof ticketAttachmentPageSchema.parse>

export function loadLocalDesktopTicketAttachments(
  workspaceId: string,
  ticketId: string,
  cursor: TicketAttachmentCursor | null,
) {
  return invoke<unknown>('get_local_ticket_attachments', { workspaceId, ticketId, cursor }).then((result) =>
    ticketAttachmentPageSchema.parse(result),
  )
}

export async function addLocalDesktopTicketAttachments(workspaceId: string, ticketId: string) {
  const result: unknown = await invoke('add_local_ticket_attachments', { workspaceId, ticketId })
  return ticketAttachmentSchema.array().parse(result)
}

export function deleteLocalDesktopTicketAttachment(workspaceId: string, ticketId: string, attachmentId: string) {
  return invoke<void>('delete_local_ticket_attachment', { workspaceId, ticketId, attachmentId })
}

export function openLocalDesktopTicketAttachment(workspaceId: string, ticketId: string, attachmentId: string) {
  return invoke<void>('open_local_ticket_attachment', { workspaceId, ticketId, attachmentId })
}

export function readLocalDesktopTicketAttachmentPreview(workspaceId: string, ticketId: string, attachmentId: string) {
  return invoke<unknown>('read_local_ticket_attachment_preview', { workspaceId, ticketId, attachmentId })
}

export function openLocalDesktopTicketAttachmentFolder() {
  return invoke<void>('open_local_ticket_attachment_folder')
}
