import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
  enqueueTicketAttachmentDelete,
  failTicketAttachmentMutation,
  getLocalTicketAttachmentBlob,
  getPendingTicketAttachmentMutations,
  getTicketAttachmentMutationSummary,
  listLocalTicketAttachmentPage,
  retryTicketAttachmentMutations,
  savePendingTicketAttachment,
} from './ticket-attachment-local-store'

describe('ticket attachment local store', () => {
  it('commits an offline file and its upload mutation durably to IndexedDB', async () => {
    const userId = crypto.randomUUID()
    const workspaceId = crypto.randomUUID()
    const ticketId = crypto.randomUUID()
    const attachmentId = crypto.randomUUID()
    const file = new File([new TextEncoder().encode('offline attachment')], 'offline.txt', { type: 'text/plain' })

    const attachment = await savePendingTicketAttachment(userId, workspaceId, ticketId, attachmentId, file)
    const page = await listLocalTicketAttachmentPage(userId, workspaceId, ticketId, null)
    const savedBlob = await getLocalTicketAttachmentBlob(userId, workspaceId, attachmentId)
    const pending = await getPendingTicketAttachmentMutations(userId, workspaceId)

    expect(attachment).toMatchObject({ id: attachmentId, fileName: 'offline.txt', sizeBytes: file.size })
    expect(page.attachments).toEqual([attachment])
    expect(savedBlob?.size).toBe(file.size)
    expect(pending).toMatchObject([{ kind: 'attachment.upload', ticketId, attachmentId, state: 'pending' }])
    await expect(getTicketAttachmentMutationSummary(userId, workspaceId, ticketId)).resolves.toEqual({
      hasPendingMutation: true,
      hasFailedMutation: false,
    })

    await enqueueTicketAttachmentDelete(userId, workspaceId, ticketId, attachmentId)
    await expect(listLocalTicketAttachmentPage(userId, workspaceId, ticketId, null)).resolves.toMatchObject({
      attachments: [],
    })
    const queued = await getPendingTicketAttachmentMutations(userId, workspaceId)
    expect(queued.map((mutation) => mutation.kind)).toEqual(['attachment.upload', 'attachment.delete'])
    expect(queued[1]?.createdAt > (queued[0]?.createdAt ?? '')).toBe(true)
  })

  it('cancels an unrecoverable local upload when its attachment is deleted', async () => {
    const userId = crypto.randomUUID()
    const workspaceId = crypto.randomUUID()
    const ticketId = crypto.randomUUID()
    const attachmentId = crypto.randomUUID()
    const file = new File(['retry later'], 'failed.txt', { type: 'text/plain' })
    await savePendingTicketAttachment(userId, workspaceId, ticketId, attachmentId, file)
    const [uploadMutation] = await getPendingTicketAttachmentMutations(userId, workspaceId)
    if (!uploadMutation) throw new Error('Expected an upload mutation.')

    await failTicketAttachmentMutation(userId, workspaceId, uploadMutation, 'conflict')
    await expect(getTicketAttachmentMutationSummary(userId, workspaceId, ticketId)).resolves.toMatchObject({
      hasFailedMutation: true,
    })
    await enqueueTicketAttachmentDelete(userId, workspaceId, ticketId, attachmentId)
    await retryTicketAttachmentMutations(userId, workspaceId, ticketId)

    const queued = await getPendingTicketAttachmentMutations(userId, workspaceId)
    expect(
      queued.filter((mutation) => mutation.attachmentId === attachmentId).map((mutation) => mutation.kind),
    ).toEqual(['attachment.delete'])
    await expect(getTicketAttachmentMutationSummary(userId, workspaceId, ticketId)).resolves.toEqual({
      hasPendingMutation: true,
      hasFailedMutation: false,
    })
  })

  it('paginates local attachments with a stable keyset cursor', async () => {
    const userId = crypto.randomUUID()
    const workspaceId = crypto.randomUUID()
    const ticketId = crypto.randomUUID()
    for (let index = 0; index < 27; index += 1) {
      await savePendingTicketAttachment(
        userId,
        workspaceId,
        ticketId,
        crypto.randomUUID(),
        new File([String(index)], `file-${index}.txt`, { type: 'text/plain' }),
      )
    }

    const firstPage = await listLocalTicketAttachmentPage(userId, workspaceId, ticketId, null)
    expect(firstPage.attachments).toHaveLength(25)
    expect(firstPage.nextCursor).not.toBeNull()
    const secondPage = await listLocalTicketAttachmentPage(userId, workspaceId, ticketId, firstPage.nextCursor)
    expect(secondPage.attachments).toHaveLength(2)
    expect(secondPage.nextCursor).toBeNull()
  })
})
