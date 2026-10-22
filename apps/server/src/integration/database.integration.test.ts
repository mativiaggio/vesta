import { randomUUID } from 'node:crypto'
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '../../../../packages/database/src/client.js'
import { richTextDocumentSchema } from '../../../../packages/notes/src/contract.js'
import {
  client as clientRecord,
  note as noteRecord,
  noteAttachment as noteAttachmentRecord,
  rateLimit,
  syncMutationReceipt,
  ticket as ticketRecord,
  ticketAttachment as ticketAttachmentRecord,
  user,
  workspace,
  workspaceMembership,
  workspaceMutationRateLimit,
} from '../../../../packages/database/src/schema.js'
import { retentionMaintenanceLockName, runRetentionMaintenance } from '../maintenance/sync-receipt-retention.js'
import { PostgresMutationRateLimiter } from '../rate-limit/postgres-mutation-rate-limiter.js'
import {
  activateWorkspaceForUser,
  createWorkspaceForUser,
  listWorkspacePageForUser,
  maxOutstandingMutationReceiptsPerUser,
} from '../workspaces/data/workspace-repository.js'
import {
  createClientForWorkspace,
  deleteClientForWorkspace,
  listClientsForWorkspace,
  listClientsForWorkspaceForSync,
  updateClientForWorkspace,
} from '../clients/client-repository.js'
import {
  createTicketForWorkspace,
  deleteTicketForWorkspace,
  getNextTicketOtNumber,
  listTicketsForWorkspace,
  listTicketsForWorkspaceForSync,
  updateTicketForWorkspace,
} from '../tickets/ticket-repository.js'
import {
  createTicketAttachment,
  listTicketAttachments,
  softDeleteTicketAttachment,
} from '../attachments/attachment-repository.js'
import {
  createNoteForWorkspace,
  deleteNoteForWorkspace,
  listNotesForWorkspace,
  listNotesForWorkspaceForSync,
  updateNoteForWorkspace,
} from '../notes/note-repository.js'
import { createNoteAttachment, listNoteAttachments } from '../notes/note-attachment-repository.js'

const firstUserId = randomUUID()
const secondUserId = randomUUID()
const workspaceId = randomUUID()
const createMutationId = randomUUID()
const activationMutationId = randomUUID()
const clientId = randomUUID()
const secondClientId = randomUUID()
const clientCreateMutationId = randomUUID()
const clientUpdateNameMutationId = randomUUID()
const clientUpdateActiveMutationId = randomUUID()
const clientDeleteMutationId = randomUUID()
const secondClientCreateMutationId = randomUUID()
const ticketId = randomUUID()
const notesTicketId = randomUUID()
const notesTicketCreateMutationId = randomUUID()
const noteId = randomUUID()
const noteCreateMutationId = randomUUID()
const noteUpdateMutationId = randomUUID()
const noteStaleUpdateMutationId = randomUUID()
const noteDeleteMutationId = randomUUID()
const noteAttachmentId = randomUUID()
const ticketClientId = randomUUID()
const ticketClientCreateMutationId = randomUUID()
const ticketCreateMutationId = randomUUID()
const ticketDeliveredMutationId = randomUUID()
const ticketProductionMutationId = randomUUID()
const ticketDeleteMutationId = randomUUID()
const ticketAttachmentId = randomUUID()
const ticketCascadeAttachmentId = randomUUID()
const limiterScope = `integration:${randomUUID()}`
const authRateLimitKey = `integration-auth:${randomUUID()}`

describe('PostgreSQL workspace persistence', () => {
  beforeAll(async () => {
    await db.insert(user).values([
      { id: firstUserId, name: 'First User', email: `${firstUserId}@example.test` },
      { id: secondUserId, name: 'Second User', email: `${secondUserId}@example.test` },
    ])
  })

  afterAll(async () => {
    await db.delete(syncMutationReceipt).where(inArray(syncMutationReceipt.userId, [firstUserId, secondUserId]))
    await db.delete(noteAttachmentRecord).where(eq(noteAttachmentRecord.workspaceId, workspaceId))
    await db.delete(noteRecord).where(eq(noteRecord.workspaceId, workspaceId))
    await db.delete(ticketAttachmentRecord).where(eq(ticketAttachmentRecord.workspaceId, workspaceId))
    await db.delete(ticketRecord).where(eq(ticketRecord.workspaceId, workspaceId))
    await db.delete(clientRecord).where(eq(clientRecord.workspaceId, workspaceId))
    await db.delete(workspaceMembership).where(inArray(workspaceMembership.userId, [firstUserId, secondUserId]))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(workspaceMutationRateLimit).where(sql`${workspaceMutationRateLimit.key} like ${`${limiterScope}%`}`)
    await db.delete(rateLimit).where(eq(rateLimit.key, authRateLimitKey))
    await db.delete(user).where(inArray(user.id, [firstUserId, secondUserId]))
    await pool.end()
  })

  it('creates a workspace atomically and replays an identical mutation idempotently', async () => {
    const input = {
      id: workspaceId,
      clientMutationId: createMutationId,
      name: 'Integration Studio',
      accentColor: 'olive' as const,
      icon: 'briefcase' as const,
    }

    const created = await createWorkspaceForUser(firstUserId, input)
    const replayed = await createWorkspaceForUser(firstUserId, input)
    expect(created).toEqual(replayed)
    expect(created.kind).toBe('created')

    const receipts = await db
      .select({ id: syncMutationReceipt.id })
      .from(syncMutationReceipt)
      .where(and(eq(syncMutationReceipt.userId, firstUserId), eq(syncMutationReceipt.mutationId, createMutationId)))
    expect(receipts).toHaveLength(1)
  })

  it('rejects mutation-id reuse with different content and enforces tenant membership', async () => {
    const conflict = await createWorkspaceForUser(firstUserId, {
      id: workspaceId,
      clientMutationId: createMutationId,
      name: 'Different Studio',
      accentColor: 'blue',
      icon: 'folder',
    })
    expect(conflict.kind).toBe('conflict')

    const otherUserPage = await listWorkspacePageForUser(secondUserId, null)
    expect(otherUserPage.workspaces).toEqual([])
    expect(
      await activateWorkspaceForUser(secondUserId, workspaceId, {
        clientMutationId: randomUUID(),
        accessedAt: new Date().toISOString(),
      }),
    ).toEqual({ kind: 'not-found' })
  })

  it('scopes clients to workspace membership, merges field patches, and retains soft-deleted rows', async () => {
    const input = {
      id: clientId,
      clientMutationId: clientCreateMutationId,
      code: 'CLIENT-001',
      name: 'Client One',
      active: true,
    }
    const firstCreate = await createClientForWorkspace(firstUserId, workspaceId, input)
    const createReplay = await createClientForWorkspace(firstUserId, workspaceId, input)
    expect(firstCreate).toEqual(createReplay)
    expect(firstCreate.kind).toBe('created')
    if (firstCreate.kind !== 'created') throw new Error('Expected the client to be created.')
    expect(firstCreate.client.createdByUserId).toBe(firstUserId)

    const duplicateCode = await createClientForWorkspace(firstUserId, workspaceId, {
      ...input,
      id: secondClientId,
      clientMutationId: secondClientCreateMutationId,
      code: 'client-001',
    })
    expect(duplicateCode.kind).toBe('conflict')

    const nameUpdate = await updateClientForWorkspace(firstUserId, workspaceId, clientId, {
      name: 'Renamed Client',
      expectedVersion: 1,
      clientMutationId: clientUpdateNameMutationId,
    })
    expect(nameUpdate.kind).toBe('updated')
    const activeUpdate = await updateClientForWorkspace(firstUserId, workspaceId, clientId, {
      active: false,
      expectedVersion: 1,
      clientMutationId: clientUpdateActiveMutationId,
    })
    expect(activeUpdate.kind).toBe('updated')
    if (activeUpdate.kind !== 'updated') throw new Error('Expected the client to be updated.')
    expect(activeUpdate.client).toMatchObject({
      name: 'Renamed Client',
      active: false,
      version: 3,
      updatedByUserId: firstUserId,
    })

    const deniedList = await listClientsForWorkspace(secondUserId, workspaceId, null, '')
    expect(deniedList.kind).toBe('not-found')

    const deletion = await deleteClientForWorkspace(firstUserId, workspaceId, clientId, {
      expectedVersion: 1,
      clientMutationId: clientDeleteMutationId,
    })
    expect(deletion.kind).toBe('deleted')
    const activePage = await listClientsForWorkspace(firstUserId, workspaceId, null, '')
    expect(activePage.kind).toBe('listed')
    expect(activePage.clients.some((item) => item.id === clientId)).toBe(false)

    const syncPage = await listClientsForWorkspaceForSync(firstUserId, workspaceId, null)
    expect(syncPage.kind).toBe('listed')
    const deletedClient = syncPage.clients.find((item) => item.id === clientId)
    expect(deletedClient?.deletedByUserId).toBe(firstUserId)
    expect(typeof deletedClient?.deletedAt).toBe('string')
    const persistedRows = await db
      .select({ id: clientRecord.id })
      .from(clientRecord)
      .where(eq(clientRecord.id, clientId))
    expect(persistedRows).toHaveLength(1)

    const reusedCode = await createClientForWorkspace(firstUserId, workspaceId, {
      id: secondClientId,
      clientMutationId: secondClientCreateMutationId,
      code: 'client-001',
      name: 'Replacement Client',
      active: true,
    })
    expect(reusedCode.kind).toBe('created')

    const baseTime = Date.now() + 5_000
    await db.insert(clientRecord).values(
      Array.from({ length: 26 }, (_, index) => {
        const createdAt = new Date(baseTime + index * 1_000)
        return {
          id: randomUUID(),
          workspaceId,
          code: `PAGE-${String(index).padStart(3, '0')}`,
          name: index === 25 ? 'Needle Client' : 'Paged Client',
          active: true,
          version: 1,
          createdByUserId: firstUserId,
          updatedByUserId: firstUserId,
          createdAt,
          updatedAt: createdAt,
        }
      }),
    )

    const firstPage = await listClientsForWorkspace(firstUserId, workspaceId, null, '')
    expect(firstPage.clients).toHaveLength(25)
    expect(firstPage.nextCursor).not.toBeNull()
    const secondPage = await listClientsForWorkspace(firstUserId, workspaceId, firstPage.nextCursor, '')
    expect(secondPage.clients).toHaveLength(2)
    expect(secondPage.nextCursor).toBeNull()

    const filteredPage = await listClientsForWorkspace(firstUserId, workspaceId, null, 'needle')
    expect(filteredPage.clients).toHaveLength(1)
    expect(filteredPage.clients[0]?.name).toBe('Needle Client')
    expect(filteredPage.nextCursor).toBeNull()
  })

  it('validates ticket clients, records stage dates, paginates filters, and retains deleted tickets', async () => {
    const createdClient = await createClientForWorkspace(firstUserId, workspaceId, {
      id: ticketClientId,
      clientMutationId: ticketClientCreateMutationId,
      code: 'TICKET-CLIENT',
      name: 'Ticket Client',
      active: true,
    })
    expect(createdClient.kind).toBe('created')

    const ticketInput = {
      id: ticketId,
      clientMutationId: ticketCreateMutationId,
      otNumber: 1,
      clientId: randomUUID(),
      title: 'Launch review',
      description: 'Prepare release notes',
      priority: 'high' as const,
      status: 'requested' as const,
      estimatedHours: 5.5,
      workedHours: 1.25,
    }
    const invalidClient = await createTicketForWorkspace(firstUserId, workspaceId, ticketInput)
    expect(invalidClient.kind).toBe('invalid-client')

    const validTicketInput = { ...ticketInput, clientId: ticketClientId }
    const created = await createTicketForWorkspace(firstUserId, workspaceId, validTicketInput)
    const replayed = await createTicketForWorkspace(firstUserId, workspaceId, validTicketInput)
    expect(created).toEqual(replayed)
    expect(created.kind).toBe('created')
    if (created.kind !== 'created') throw new Error('Expected the ticket to be created.')
    expect(created.ticket).toMatchObject({
      otNumber: 1,
      clientId: ticketClientId,
      clientName: 'Ticket Client',
      estimatedHours: 5.5,
      workedHours: 1.25,
      createdByUserId: firstUserId,
    })

    const duplicateOtNumber = await createTicketForWorkspace(firstUserId, workspaceId, {
      ...validTicketInput,
      id: randomUUID(),
      clientMutationId: randomUUID(),
      clientId: null,
    })
    expect(duplicateOtNumber.kind).toBe('ot-number-conflict')

    await db
      .update(ticketRecord)
      .set({ version: 2, workedHours: 2.5, updatedAt: new Date() })
      .where(eq(ticketRecord.id, ticketId))
    const staleUpdate = await updateTicketForWorkspace(firstUserId, workspaceId, ticketId, {
      status: 'delivered',
      expectedVersion: 1,
      clientMutationId: ticketDeliveredMutationId,
    })
    expect(staleUpdate.kind).toBe('version-conflict')
    const staleReceipts = await db
      .select({ id: syncMutationReceipt.id })
      .from(syncMutationReceipt)
      .where(
        and(eq(syncMutationReceipt.userId, firstUserId), eq(syncMutationReceipt.mutationId, ticketDeliveredMutationId)),
      )
    expect(staleReceipts).toEqual([])

    const delivered = await updateTicketForWorkspace(firstUserId, workspaceId, ticketId, {
      status: 'delivered',
      expectedVersion: 2,
      clientMutationId: ticketDeliveredMutationId,
    })
    expect(delivered.kind).toBe('updated')
    if (delivered.kind !== 'updated') throw new Error('Expected the ticket to move to delivered.')
    expect(delivered.ticket.codingFinishedAt).toBeTruthy()
    expect(delivered.ticket.productionAt).toBeNull()

    const production = await updateTicketForWorkspace(firstUserId, workspaceId, ticketId, {
      status: 'production',
      expectedVersion: 3,
      clientMutationId: ticketProductionMutationId,
    })
    expect(production.kind).toBe('updated')
    if (production.kind !== 'updated') throw new Error('Expected the ticket to move to production.')
    expect(production.ticket).toMatchObject({
      status: 'production',
      version: 4,
      updatedByUserId: firstUserId,
    })
    expect(production.ticket.codingFinishedAt).toBeTruthy()
    expect(production.ticket.productionAt).toBeTruthy()

    const attachment = await createTicketAttachment({
      id: ticketAttachmentId,
      workspaceId,
      ticketId,
      userId: firstUserId,
      fileName: 'release notes.pdf',
      contentType: 'application/pdf',
      sizeBytes: 0,
      checksumSha256: 'a'.repeat(64),
      storageKey: `test/${ticketAttachmentId}`,
      now: new Date(),
    })
    expect(attachment.kind).toBe('created')
    const attachmentPage = await listTicketAttachments(firstUserId, workspaceId, ticketId, null)
    expect(attachmentPage).toMatchObject({ kind: 'listed', attachments: [{ id: ticketAttachmentId }] })
    expect((await listTicketAttachments(secondUserId, workspaceId, ticketId, null)).kind).toBe('not-found')
    expect((await softDeleteTicketAttachment(firstUserId, workspaceId, ticketId, ticketAttachmentId)).kind).toBe(
      'deleted',
    )
    const attachmentBaseTime = Date.now() + 5_000
    const pagedAttachmentIds = Array.from({ length: 26 }, () => randomUUID())
    await db.insert(ticketAttachmentRecord).values(
      pagedAttachmentIds.map((id, index) => {
        const createdAt = new Date(attachmentBaseTime + index * 1_000)
        return {
          id,
          workspaceId,
          ticketId,
          fileName: `paged-${index}.txt`,
          contentType: 'text/plain',
          sizeBytes: 1,
          checksumSha256: 'c'.repeat(64),
          storageKey: `test/${id}`,
          version: 1,
          createdByUserId: firstUserId,
          updatedByUserId: firstUserId,
          createdAt,
          updatedAt: createdAt,
        }
      }),
    )
    const firstAttachmentPage = await listTicketAttachments(firstUserId, workspaceId, ticketId, null)
    expect(firstAttachmentPage.attachments).toHaveLength(25)
    expect(firstAttachmentPage.nextCursor).not.toBeNull()
    const secondAttachmentPage = await listTicketAttachments(
      firstUserId,
      workspaceId,
      ticketId,
      firstAttachmentPage.nextCursor,
    )
    expect(secondAttachmentPage.attachments).toHaveLength(1)
    expect(secondAttachmentPage.nextCursor).toBeNull()
    const cascadeAttachment = await createTicketAttachment({
      id: ticketCascadeAttachmentId,
      workspaceId,
      ticketId,
      userId: firstUserId,
      fileName: 'source.zip',
      contentType: 'application/zip',
      sizeBytes: 1,
      checksumSha256: 'b'.repeat(64),
      storageKey: `test/${ticketCascadeAttachmentId}`,
      now: new Date(),
    })
    expect(cascadeAttachment.kind).toBe('created')

    const filtered = await listTicketsForWorkspace(firstUserId, workspaceId, null, {
      status: 'production',
      priority: 'high',
      search: 'release',
    })
    expect(filtered.tickets.map((item) => item.id)).toEqual([ticketId])
    expect(
      (await listTicketsForWorkspace(secondUserId, workspaceId, null, { status: null, priority: null, search: '' }))
        .kind,
    ).toBe('not-found')

    const deletion = await deleteTicketForWorkspace(firstUserId, workspaceId, ticketId, {
      expectedVersion: 4,
      clientMutationId: ticketDeleteMutationId,
    })
    expect(deletion.kind).toBe('deleted')
    const activePage = await listTicketsForWorkspace(firstUserId, workspaceId, null, {
      status: null,
      priority: null,
      search: '',
    })
    expect(activePage.tickets).toEqual([])
    const syncPage = await listTicketsForWorkspaceForSync(firstUserId, workspaceId, null)
    expect(syncPage.tickets.find((item) => item.id === ticketId)).toMatchObject({
      deletedByUserId: firstUserId,
      status: 'production',
    })
    expect(await getNextTicketOtNumber(firstUserId, workspaceId)).toMatchObject({ kind: 'found', nextNumber: 2 })
    const [cascadedAttachment] = await db
      .select({ deletedAt: ticketAttachmentRecord.deletedAt, deletedByUserId: ticketAttachmentRecord.deletedByUserId })
      .from(ticketAttachmentRecord)
      .where(eq(ticketAttachmentRecord.id, ticketCascadeAttachmentId))
    expect(cascadedAttachment?.deletedAt).toBeInstanceOf(Date)
    expect(cascadedAttachment?.deletedByUserId).toBe(firstUserId)
  })

  it('persists formatted notes, enforces workspace access, and synchronizes soft deletion with attachments', async () => {
    const nextNumber = await getNextTicketOtNumber(firstUserId, workspaceId)
    expect(nextNumber.kind).toBe('found')
    if (nextNumber.kind !== 'found') throw new Error('Expected the next ticket number.')
    const createdTicket = await createTicketForWorkspace(firstUserId, workspaceId, {
      id: notesTicketId,
      clientMutationId: notesTicketCreateMutationId,
      otNumber: nextNumber.nextNumber,
      clientId: null,
      title: 'Notes integration ticket',
      description: '',
      priority: 'medium',
      status: 'analysis',
      estimatedHours: 1,
      workedHours: 0,
    })
    expect(createdTicket.kind).toBe('created')

    const content = richTextDocumentSchema.parse({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Decision', marks: [{ type: 'bold' }] }] },
                {
                  type: 'orderedList',
                  attrs: { start: 1 },
                  content: [
                    {
                      type: 'listItem',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Follow up' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    const input = {
      id: noteId,
      clientMutationId: noteCreateMutationId,
      ticketId: notesTicketId,
      title: 'Deployment decision',
      content,
    }
    const createdNote = await createNoteForWorkspace(firstUserId, workspaceId, input)
    expect(createdNote.kind).toBe('created')
    expect(await createNoteForWorkspace(firstUserId, workspaceId, input)).toEqual(createdNote)
    if (createdNote.kind !== 'created') throw new Error('Expected the note to be created.')
    expect(createdNote.note.content).toEqual(content)

    const changed = await updateNoteForWorkspace(firstUserId, workspaceId, noteId, {
      title: 'Updated deployment decision',
      expectedVersion: 1,
      clientMutationId: noteUpdateMutationId,
    })
    expect(changed.kind).toBe('updated')
    const stale = await updateNoteForWorkspace(firstUserId, workspaceId, noteId, {
      title: 'Stale edit',
      expectedVersion: 1,
      clientMutationId: noteStaleUpdateMutationId,
    })
    expect(stale.kind).toBe('version-conflict')
    expect((await listNotesForWorkspace(secondUserId, workspaceId, null, { ticketId: null })).kind).toBe('not-found')

    const pageStart = Date.now() + 5_000
    await db.insert(noteRecord).values(
      Array.from({ length: 26 }, (_, index) => {
        const createdAt = new Date(pageStart + index * 1_000)
        return {
          id: randomUUID(),
          workspaceId,
          ticketId: notesTicketId,
          title: `Paged note ${index}`,
          content,
          version: 1,
          createdByUserId: firstUserId,
          updatedByUserId: firstUserId,
          createdAt,
          updatedAt: createdAt,
        }
      }),
    )
    const firstPage = await listNotesForWorkspace(firstUserId, workspaceId, null, { ticketId: notesTicketId })
    expect(firstPage.notes).toHaveLength(25)
    expect(firstPage.nextCursor).not.toBeNull()
    const secondPage = await listNotesForWorkspace(firstUserId, workspaceId, firstPage.nextCursor, {
      ticketId: notesTicketId,
    })
    expect(secondPage.notes).toHaveLength(2)
    expect(secondPage.nextCursor).toBeNull()

    const attachment = await createNoteAttachment({
      id: noteAttachmentId,
      workspaceId,
      noteId,
      userId: firstUserId,
      fileName: 'decision.txt',
      contentType: 'text/plain',
      sizeBytes: 8,
      checksumSha256: 'd'.repeat(64),
      storageKey: `test/${noteAttachmentId}`,
      now: new Date(),
    })
    expect(attachment.kind).toBe('created')
    expect((await listNoteAttachments(firstUserId, workspaceId, noteId, null)).attachments).toHaveLength(1)
    expect((await listNoteAttachments(secondUserId, workspaceId, noteId, null)).kind).toBe('not-found')

    const deletion = await deleteNoteForWorkspace(firstUserId, workspaceId, noteId, {
      expectedVersion: 2,
      clientMutationId: noteDeleteMutationId,
    })
    expect(deletion.kind).toBe('deleted')
    const activeNotesFirstPage = await listNotesForWorkspace(firstUserId, workspaceId, null, {
      ticketId: notesTicketId,
    })
    const activeNotesSecondPage = activeNotesFirstPage.nextCursor
      ? await listNotesForWorkspace(firstUserId, workspaceId, activeNotesFirstPage.nextCursor, {
          ticketId: notesTicketId,
        })
      : null
    expect(
      [...activeNotesFirstPage.notes, ...(activeNotesSecondPage?.notes ?? [])].some((item) => item.id === noteId),
    ).toBe(false)
    const syncPage = await listNotesForWorkspaceForSync(firstUserId, workspaceId, null)
    const syncTail = syncPage.nextCursor
      ? await listNotesForWorkspaceForSync(firstUserId, workspaceId, syncPage.nextCursor)
      : null
    expect([...syncPage.notes, ...(syncTail?.notes ?? [])].find((item) => item.id === noteId)?.deletedByUserId).toBe(
      firstUserId,
    )
    const [deletedAttachment] = await db
      .select({ deletedAt: noteAttachmentRecord.deletedAt, deletedByUserId: noteAttachmentRecord.deletedByUserId })
      .from(noteAttachmentRecord)
      .where(eq(noteAttachmentRecord.id, noteAttachmentId))
    expect(deletedAttachment?.deletedAt).toBeInstanceOf(Date)
    expect(deletedAttachment?.deletedByUserId).toBe(firstUserId)
  })

  it('replays activation idempotently without incrementing membership twice', async () => {
    const mutation = {
      clientMutationId: activationMutationId,
      accessedAt: new Date(Date.now() + 1000).toISOString(),
    }
    const first = await activateWorkspaceForUser(firstUserId, workspaceId, mutation)
    const replay = await activateWorkspaceForUser(firstUserId, workspaceId, mutation)
    expect(first).toEqual(replay)
    expect(first.kind).toBe('activated')
    if (first.kind === 'activated') expect(first.activation.membershipVersion).toBe(2)
  })

  it('atomically serializes hourly and daily limits across limiter instances', async () => {
    const firstLimiter = new PostgresMutationRateLimiter()
    const secondLimiter = new PostgresMutationRateLimiter()
    const policies = [
      { suffix: 'hour', windowMs: 60_000, max: 5 },
      { suffix: 'day', windowMs: 120_000, max: 8 },
    ] as const
    const decisions = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        (index % 2 === 0 ? firstLimiter : secondLimiter).consume(limiterScope, policies),
      ),
    )
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5)
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(5)

    const rows = await db
      .select({ key: workspaceMutationRateLimit.key, count: workspaceMutationRateLimit.count })
      .from(workspaceMutationRateLimit)
      .where(sql`${workspaceMutationRateLimit.key} like ${`${limiterScope}%`}`)
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.count === 5)).toBe(true)
  })

  it('keeps workspace limits isolated from Better Auth pruning', async () => {
    await db.insert(rateLimit).values({
      id: randomUUID(),
      key: authRateLimitKey,
      count: 1,
      lastRequest: Date.now() - 2 * 60 * 60 * 1000,
    })

    await db.delete(rateLimit).where(eq(rateLimit.key, authRateLimitKey))

    const workspaceLimits = await db
      .select({ count: count() })
      .from(workspaceMutationRateLimit)
      .where(sql`${workspaceMutationRateLimit.key} like ${`${limiterScope}%`}`)
    expect(workspaceLimits[0]?.count).toBe(2)
  })

  it('purges expired maintenance rows in bounded batches and skips a competing replica', async () => {
    const now = new Date()
    const expiredAt = new Date(now.getTime() - 60_000)
    const futureExpiry = new Date(now.getTime() + 60_000)
    const receiptPrefix = `retention-${randomUUID()}`
    const ratePrefix = `retention-rate-${randomUUID()}`

    await db.insert(syncMutationReceipt).values(
      Array.from({ length: 9 }, (_, index) => ({
        id: `${receiptPrefix}-${index}`,
        userId: firstUserId,
        mutationId: `${receiptPrefix}-mutation-${index}`,
        kind: 'workspace.activate',
        entityId: workspaceId,
        payloadHash: 'integration',
        expiresAt: index < 7 ? expiredAt : futureExpiry,
      })),
    )
    await db.insert(workspaceMutationRateLimit).values(
      Array.from({ length: 3 }, (_, index) => ({
        id: `${ratePrefix}-${index}`,
        key: `${ratePrefix}-${index}`,
        count: 1,
        windowStartedAt: expiredAt,
        expiresAt: expiredAt,
      })),
    )

    const firstRun = await runRetentionMaintenance({ now, batchSize: 2, maxBatches: 2 })
    expect(firstRun).toMatchObject({ acquired: true, purgedReceipts: 4, purgedRateLimits: 3, hasMore: true })

    const secondRun = await runRetentionMaintenance({ now, batchSize: 2, maxBatches: 10 })
    expect(secondRun).toMatchObject({ acquired: true, purgedReceipts: 3, hasMore: false })

    const [remaining] = await db
      .select({ count: count() })
      .from(syncMutationReceipt)
      .where(
        and(eq(syncMutationReceipt.userId, firstUserId), sql`${syncMutationReceipt.id} like ${`${receiptPrefix}%`}`),
      )
    expect(remaining?.count).toBe(2)

    await db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${retentionMaintenanceLockName}))`)
      const competingRun = await runRetentionMaintenance({ now })
      expect(competingRun.acquired).toBe(false)
    })
  })

  it('enforces a hard per-user receipt cap without creating domain data', async () => {
    const [usage] = await db
      .select({ count: count() })
      .from(syncMutationReceipt)
      .where(and(eq(syncMutationReceipt.userId, secondUserId), isNull(syncMutationReceipt.deletedAt)))
    const missing = maxOutstandingMutationReceiptsPerUser - (usage?.count ?? 0)

    await db.execute(sql`
      insert into sync_mutation_receipt
        (id, user_id, mutation_id, kind, entity_id, payload_hash, expires_at, created_at, updated_at)
      select
        ${`capacity-${secondUserId}-`} || value::text,
        ${secondUserId},
        ${`capacity-mutation-${secondUserId}-`} || value::text,
        'workspace.activate',
        ${workspaceId},
        'integration',
        now() + interval '30 days',
        now(),
        now()
      from generate_series(1, ${missing}) as series(value)
    `)

    const blockedWorkspaceId = randomUUID()
    const result = await createWorkspaceForUser(secondUserId, {
      id: blockedWorkspaceId,
      clientMutationId: randomUUID(),
      name: 'Must not exist',
      accentColor: 'blue',
      icon: 'folder',
    })
    expect(result).toEqual({ kind: 'capacity' })

    const [created] = await db.select({ id: workspace.id }).from(workspace).where(eq(workspace.id, blockedWorkspaceId))
    expect(created).toBeUndefined()
  })
})
