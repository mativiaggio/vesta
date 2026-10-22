import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { NoteAttachment } from '../../../../packages/notes/src/attachment-contract'
import {
  discardLocalNoteAttachmentsForNote,
  enqueueNoteAttachmentDelete,
  getPendingNoteAttachmentMutations,
  listLocalNoteAttachmentPage,
  markNoteAttachmentDeleted,
  markNoteAttachmentMutationSyncing,
  markNoteAttachmentUploaded,
  savePendingNoteAttachment,
} from './note-attachment-local-store'

describe('note attachment local store', () => {
  it('persists the file blob with a queued, durable upload mutation', async () => {
    const userId = `user-${crypto.randomUUID()}`
    const workspaceId = crypto.randomUUID()
    const noteId = crypto.randomUUID()
    const file = new File([new TextEncoder().encode('offline note attachment')], 'decision.txt', { type: 'text/plain' })

    const saved = await savePendingNoteAttachment(userId, workspaceId, noteId, file)
    const page = await listLocalNoteAttachmentPage(userId, workspaceId, noteId, null)
    const pending = await getPendingNoteAttachmentMutations(userId, workspaceId)

    expect(page.attachments).toMatchObject([{ id: saved.id, fileName: 'decision.txt', sizeBytes: file.size }])
    expect(page.localAttachments[0]?.blob).toBeInstanceOf(Blob)
    expect(pending).toMatchObject([{ noteId, attachmentId: saved.id, kind: 'attachment.upload', state: 'pending' }])
  })

  it('cancels a pending upload when its unsynchronized attachment is removed', async () => {
    const userId = `user-${crypto.randomUUID()}`
    const workspaceId = crypto.randomUUID()
    const noteId = crypto.randomUUID()
    const attachment = await savePendingNoteAttachment(
      userId,
      workspaceId,
      noteId,
      new File(['pending'], 'pending.txt', { type: 'text/plain' }),
    )

    await enqueueNoteAttachmentDelete(userId, workspaceId, noteId, attachment.id)

    expect((await listLocalNoteAttachmentPage(userId, workspaceId, noteId, null)).attachments).toEqual([])
    expect(await getPendingNoteAttachmentMutations(userId, workspaceId)).toEqual([])
  })

  it('keeps a delete queued if an upload is already in flight', async () => {
    const userId = `user-${crypto.randomUUID()}`
    const workspaceId = crypto.randomUUID()
    const noteId = crypto.randomUUID()
    const attachment = await savePendingNoteAttachment(
      userId,
      workspaceId,
      noteId,
      new File(['in flight'], 'in-flight.txt', { type: 'text/plain' }),
    )
    const [upload] = await getPendingNoteAttachmentMutations(userId, workspaceId)
    if (!upload) throw new Error('Expected pending upload.')
    await markNoteAttachmentMutationSyncing(upload)
    await enqueueNoteAttachmentDelete(userId, workspaceId, noteId, attachment.id)

    const uploaded: NoteAttachment = {
      ...attachment,
      checksumSha256: 'a'.repeat(64),
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    }
    await markNoteAttachmentUploaded(userId, workspaceId, uploaded)

    expect((await listLocalNoteAttachmentPage(userId, workspaceId, noteId, null)).attachments).toEqual([])
    expect(await getPendingNoteAttachmentMutations(userId, workspaceId)).toMatchObject([
      { noteId, attachmentId: attachment.id, kind: 'attachment.delete', state: 'pending' },
    ])
    await markNoteAttachmentDeleted(userId, workspaceId, attachment.id)
    expect(await getPendingNoteAttachmentMutations(userId, workspaceId)).toEqual([])
  })

  it('paginates local attachment metadata in bounded pages and drops the cache with its note', async () => {
    const userId = `user-${crypto.randomUUID()}`
    const workspaceId = crypto.randomUUID()
    const noteId = crypto.randomUUID()
    for (let index = 0; index < 27; index += 1) {
      await savePendingNoteAttachment(
        userId,
        workspaceId,
        noteId,
        new File([`file ${index}`], `file-${index}.txt`, { type: 'text/plain' }),
      )
    }

    const first = await listLocalNoteAttachmentPage(userId, workspaceId, noteId, null)
    const second = await listLocalNoteAttachmentPage(userId, workspaceId, noteId, first.nextCursor)
    expect(first.attachments).toHaveLength(25)
    expect(second.attachments).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()
    await discardLocalNoteAttachmentsForNote(userId, workspaceId, noteId)
    expect(await listLocalNoteAttachmentPage(userId, workspaceId, noteId, null)).toMatchObject({
      attachments: [],
      nextCursor: null,
    })
    expect(await getPendingNoteAttachmentMutations(userId, workspaceId)).toEqual([])
  })
})
