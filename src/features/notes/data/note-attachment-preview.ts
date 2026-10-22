import type { NoteAttachment } from '../../../../packages/notes/src/attachment-contract'
import { attachmentImageType } from '../../attachments/image-preview'

export function noteAttachmentImageType(attachment: NoteAttachment): string | null {
  return attachmentImageType(attachment.fileName, attachment.contentType)
}
