import type { TicketAttachment } from '../../../../packages/tickets/src/attachment-contract'

const imageTypesByExtension: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
}

const previewableImageTypes = new Set(Object.values(imageTypesByExtension))

export function ticketAttachmentImageType(attachment: TicketAttachment): string | null {
  const contentType = attachment.contentType.toLowerCase()
  if (previewableImageTypes.has(contentType)) return contentType
  if (contentType !== 'application/octet-stream') return null
  const extension = attachment.fileName.split('.').at(-1)?.toLowerCase() ?? ''
  return imageTypesByExtension[extension] ?? null
}
