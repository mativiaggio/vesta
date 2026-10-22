import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import {
  noteAttachmentPageSchema,
  noteAttachmentSchema,
  type NoteAttachmentCursor,
} from '../../../../packages/notes/src/attachment-contract'

export type LocalDesktopNoteAttachmentPage = z.infer<typeof noteAttachmentPageSchema>

export async function loadLocalDesktopNoteAttachments(
  workspaceId: string,
  noteId: string,
  cursor: NoteAttachmentCursor | null,
) {
  const result: unknown = await invoke('get_local_note_attachments', { workspaceId, noteId, cursor })
  return noteAttachmentPageSchema.parse(result)
}

export async function addLocalDesktopNoteAttachments(workspaceId: string, noteId: string) {
  const result: unknown = await invoke('add_local_note_attachments', { workspaceId, noteId })
  return z.array(noteAttachmentSchema).parse(result)
}

export function deleteLocalDesktopNoteAttachment(workspaceId: string, noteId: string, attachmentId: string) {
  return invoke<void>('delete_local_note_attachment', { workspaceId, noteId, attachmentId })
}

export function openLocalDesktopNoteAttachment(workspaceId: string, noteId: string, attachmentId: string) {
  return invoke<void>('open_local_note_attachment', { workspaceId, noteId, attachmentId })
}

export function readLocalDesktopNoteAttachmentPreview(workspaceId: string, noteId: string, attachmentId: string) {
  return invoke<unknown>('read_local_note_attachment_preview', { workspaceId, noteId, attachmentId })
}
