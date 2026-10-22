import type { TicketAttachment } from '../../../../packages/tickets/src/attachment-contract'
import { attachmentImageType } from '../../attachments/image-preview'

export function ticketAttachmentImageType(attachment: TicketAttachment): string | null {
  return attachmentImageType(attachment.fileName, attachment.contentType)
}
