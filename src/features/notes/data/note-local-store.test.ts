import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { Note } from '../../../../packages/notes/src/contract'
import {
  completeNoteMutation,
  enqueueNoteCreation,
  enqueueNoteDeletion,
  enqueueNoteUpdate,
  listPendingNoteMutations,
  loadLocalNotePage,
  recordNoteVersionConflict,
  resolveNoteConflictDeleteLatest,
  resolveNoteConflictWithLocal,
  resolveNoteConflictWithRemote,
  type NoteMutation,
} from './note-local-store'

const emptyContent: Note['content'] = { type: 'doc', content: [{ type: 'paragraph' }] }

function noteTicket(otNumber: number): Note['ticket'] {
  return { otNumber, title: `Ticket ${otNumber}`, status: 'analysis', clientId: null, clientName: null }
}

describe('note local store', () => {
  it('commits a note and its pending create mutation to durable storage together', async () => {
    const userId = `user-${crypto.randomUUID()}`
    const workspaceId = crypto.randomUUID()
    const ticketId = crypto.randomUUID()
    const ticket = noteTicket(1)
    const note = await enqueueNoteCreation(
      userId,
      workspaceId,
      { ticketId, title: 'A decision', content: emptyContent },
      ticket,
    )

    expect(await loadLocalNotePage(userId, workspaceId, null, { ticketId: null })).toMatchObject({
      notes: [{ id: note.id, title: 'A decision', ticketId }],
      pendingCount: 1,
      hasLocalData: true,
    })
    expect(await listPendingNoteMutations(userId, workspaceId)).toMatchObject([
      { noteId: note.id, kind: 'note.create', payload: { ticketId } },
    ])
  })

  it('paginates note collections by a stable keyset and applies ticket filters before the page limit', async () => {
    const userId = `user-${crypto.randomUUID()}`
    const workspaceId = crypto.randomUUID()
    const ticketId = crypto.randomUUID()
    const otherTicketId = crypto.randomUUID()
    for (let index = 0; index < 27; index += 1) {
      await enqueueNoteCreation(
        userId,
        workspaceId,
        { ticketId, title: `Note ${index}`, content: emptyContent },
        noteTicket(1),
      )
    }
    await enqueueNoteCreation(
      userId,
      workspaceId,
      { ticketId: otherTicketId, title: 'Another ticket note', content: emptyContent },
      noteTicket(2),
    )

    const first = await loadLocalNotePage(userId, workspaceId, null, { ticketId })
    const second = await loadLocalNotePage(userId, workspaceId, first.nextCursor, { ticketId })
    const ids = new Set([...first.notes, ...second.notes].map((note) => note.id))

    expect(first.notes).toHaveLength(25)
    expect(first.nextCursor).not.toBeNull()
    expect(second.notes).toHaveLength(2)
    expect(second.nextCursor).toBeNull()
    expect(ids.size).toBe(27)
    expect([...first.notes, ...second.notes].every((note) => note.ticketId === ticketId)).toBe(true)
  })

  it('hides a locally created note after soft deletion without sending an uncreated record', async () => {
    const userId = `user-${crypto.randomUUID()}`
    const workspaceId = crypto.randomUUID()
    const ticketId = crypto.randomUUID()
    const note = await enqueueNoteCreation(
      userId,
      workspaceId,
      { ticketId, title: 'Unsynced note', content: emptyContent },
      noteTicket(1),
    )

    await enqueueNoteDeletion(userId, workspaceId, note.id)

    expect((await loadLocalNotePage(userId, workspaceId, null, { ticketId: null })).notes).toEqual([])
    expect(await listPendingNoteMutations(userId, workspaceId)).toEqual([])
  })

  it('coalesces offline edits and rebases them after the create receives a server version', async () => {
    const userId = `user-${crypto.randomUUID()}`
    const workspaceId = crypto.randomUUID()
    const ticketId = crypto.randomUUID()
    const ticket = noteTicket(1)
    const note = await enqueueNoteCreation(
      userId,
      workspaceId,
      { ticketId, title: 'First', content: emptyContent },
      ticket,
    )
    await enqueueNoteUpdate(userId, workspaceId, note.id, { title: 'Second' }, ticket)
    await enqueueNoteUpdate(userId, workspaceId, note.id, { title: 'Final' }, ticket)

    const [createMutation] = await listPendingNoteMutations(userId, workspaceId)
    if (!createMutation || createMutation.kind !== 'note.create') throw new Error('Expected note create mutation.')
    const synced = { ...note, version: 1, createdAt: note.createdAt, updatedAt: note.updatedAt }
    await completeNoteMutation(createMutation, synced)

    const pending = await listPendingNoteMutations(userId, workspaceId)
    const updateMutation = pending.find(
      (mutation): mutation is Extract<NoteMutation, { kind: 'note.update' }> => mutation.kind === 'note.update',
    )
    expect(updateMutation?.payload).toMatchObject({ title: 'Final', expectedVersion: 1 })
  })

  it('lets a user explicitly keep the latest server copy after an edit conflict', async () => {
    const userId = `user-${crypto.randomUUID()}`
    const workspaceId = crypto.randomUUID()
    const ticketId = crypto.randomUUID()
    const ticket = noteTicket(3)
    const created = await enqueueNoteCreation(
      userId,
      workspaceId,
      { ticketId, title: 'Base', content: emptyContent },
      ticket,
    )
    const [create] = await listPendingNoteMutations(userId, workspaceId)
    if (!create || create.kind !== 'note.create') throw new Error('Expected a create mutation.')
    const base = { ...created, version: 1 }
    await completeNoteMutation(create, base)
    await enqueueNoteUpdate(userId, workspaceId, created.id, { title: 'My local edit' }, ticket)
    const [update] = await listPendingNoteMutations(userId, workspaceId)
    if (!update || update.kind !== 'note.update') throw new Error('Expected an update mutation.')
    const remote = { ...base, title: 'Remote edit', version: 2, updatedAt: new Date().toISOString() }

    await recordNoteVersionConflict(update, remote)
    const conflicted = await loadLocalNotePage(userId, workspaceId, null, { ticketId: null })
    expect(conflicted.notes[0]).toMatchObject({
      title: 'My local edit',
      conflict: { kind: 'note.update', remote: { title: 'Remote edit' } },
    })

    await resolveNoteConflictWithRemote(userId, workspaceId, created.id)
    const resolved = await loadLocalNotePage(userId, workspaceId, null, { ticketId: null })
    expect(resolved.notes[0]).toMatchObject({ title: 'Remote edit', version: 2 })
    expect(await listPendingNoteMutations(userId, workspaceId)).toEqual([])
  })

  it('rebases explicitly retained local edits on the latest server version', async () => {
    const userId = `user-${crypto.randomUUID()}`
    const workspaceId = crypto.randomUUID()
    const ticketId = crypto.randomUUID()
    const ticket = noteTicket(4)
    const created = await enqueueNoteCreation(
      userId,
      workspaceId,
      { ticketId, title: 'Base', content: emptyContent },
      ticket,
    )
    const [create] = await listPendingNoteMutations(userId, workspaceId)
    if (!create || create.kind !== 'note.create') throw new Error('Expected a create mutation.')
    const base = { ...created, version: 1 }
    await completeNoteMutation(create, base)
    await enqueueNoteUpdate(userId, workspaceId, created.id, { title: 'My local edit' }, ticket)
    const [update] = await listPendingNoteMutations(userId, workspaceId)
    if (!update || update.kind !== 'note.update') throw new Error('Expected an update mutation.')
    const remote = { ...base, title: 'Remote edit', version: 3, updatedAt: new Date().toISOString() }

    await recordNoteVersionConflict(update, remote)
    await resolveNoteConflictWithLocal(userId, workspaceId, created.id)

    const [rebased] = await listPendingNoteMutations(userId, workspaceId)
    expect(rebased).toMatchObject({ kind: 'note.update', payload: { title: 'My local edit', expectedVersion: 3 } })
    const resolved = (await loadLocalNotePage(userId, workspaceId, null, { ticketId: null })).notes[0]
    expect(resolved).toMatchObject({
      title: 'My local edit',
      version: 4,
    })
    expect(resolved).not.toHaveProperty('conflict')
  })

  it('requires an explicit choice before applying a deletion against a changed server copy', async () => {
    const userId = `user-${crypto.randomUUID()}`
    const workspaceId = crypto.randomUUID()
    const ticketId = crypto.randomUUID()
    const ticket = noteTicket(5)
    const created = await enqueueNoteCreation(
      userId,
      workspaceId,
      { ticketId, title: 'Base', content: emptyContent },
      ticket,
    )
    const [create] = await listPendingNoteMutations(userId, workspaceId)
    if (!create || create.kind !== 'note.create') throw new Error('Expected a create mutation.')
    const base = { ...created, version: 1 }
    await completeNoteMutation(create, base)
    await enqueueNoteDeletion(userId, workspaceId, created.id)
    const [deletion] = await listPendingNoteMutations(userId, workspaceId)
    if (!deletion || deletion.kind !== 'note.delete') throw new Error('Expected a delete mutation.')
    const remote = { ...base, title: 'Updated before deletion', version: 2, updatedAt: new Date().toISOString() }

    await recordNoteVersionConflict(deletion, remote)
    expect((await loadLocalNotePage(userId, workspaceId, null, { ticketId: null })).notes[0]).toMatchObject({
      title: 'Updated before deletion',
      conflict: { kind: 'note.delete' },
    })
    await resolveNoteConflictDeleteLatest(userId, workspaceId, created.id)

    const [rebasedDeletion] = await listPendingNoteMutations(userId, workspaceId)
    expect(rebasedDeletion).toMatchObject({ kind: 'note.delete', payload: { expectedVersion: 2 } })
    expect((await loadLocalNotePage(userId, workspaceId, null, { ticketId: null })).notes).toEqual([])
  })
})
