import { describe, expect, it } from 'vitest'
import type { TicketAttachment } from '../../../../packages/tickets/src/attachment-contract'
import { ticketAttachmentImageType } from './ticket-attachment-preview'

function attachment(fileName: string, contentType: string): TicketAttachment {
  const now = '2026-10-22T00:00:00.000Z'
  return {
    id: '7e2ef25d-12e5-4868-bfe8-c4636416bda5',
    workspaceId: 'eeac70d8-c8aa-4e88-9546-d6c20c69d092',
    ticketId: 'a82118a1-802e-49e6-8298-049282ad5d10',
    fileName,
    contentType,
    sizeBytes: 10,
    checksumSha256: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

describe('ticket attachment image previews', () => {
  it('recognizes supported raster images from their verified content type', () => {
    expect(ticketAttachmentImageType(attachment('capture.jpg', 'image/jpeg'))).toBe('image/jpeg')
    expect(ticketAttachmentImageType(attachment('capture', 'image/webp'))).toBe('image/webp')
  })

  it('uses a supported file extension for legacy local attachments without a content type', () => {
    expect(ticketAttachmentImageType(attachment('capture.PNG', 'application/octet-stream'))).toBe('image/png')
  })

  it('does not preview active content or arbitrary files as images', () => {
    expect(ticketAttachmentImageType(attachment('diagram.svg', 'image/svg+xml'))).toBeNull()
    expect(ticketAttachmentImageType(attachment('script.png', 'text/html'))).toBeNull()
    expect(ticketAttachmentImageType(attachment('notes.txt', 'application/octet-stream'))).toBeNull()
  })
})
