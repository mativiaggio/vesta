import {
  ticketAttachmentPageSize,
  ticketAttachmentSchema,
  type TicketAttachment,
  type TicketAttachmentCursor,
  type TicketAttachmentPage,
} from '../../../../packages/tickets/src/attachment-contract'

const databaseName = 'vesta-ticket-attachments'
const databaseVersion = 1
const attachmentStoreName = 'attachments'
const mutationStoreName = 'mutations'

type SyncState = 'local' | 'pending' | 'synced' | 'failed'

type LocalAttachment = TicketAttachment & {
  localKey: string
  scope: string
  userId: string
  active: 0 | 1
  blob: Blob | null
  syncState: SyncState
}

type AttachmentMutation = {
  id: string
  userId: string
  workspaceId: string
  ticketId: string
  attachmentId: string
  kind: 'attachment.upload' | 'attachment.delete'
  createdAt: string
  state: 'pending' | 'failed'
  lastError: string | null
  attempts: number
}

type LocalAttachmentPage = TicketAttachmentPage & { localAttachments: LocalAttachment[] }

let databasePromise: Promise<IDBDatabase> | null = null

function scopeKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`
}

function attachmentKey(userId: string, workspaceId: string, attachmentId: string): string {
  return `${scopeKey(userId, workspaceId)}:${attachmentId}`
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error ?? new Error('Attachment storage request failed.')), {
      once: true,
    })
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('Attachment storage failed.')), {
      once: true,
    })
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('Attachment storage failed.')), {
      once: true,
    })
  })
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)
    request.addEventListener(
      'upgradeneeded',
      () => {
        const database = request.result
        const attachmentStore = database.createObjectStore(attachmentStoreName, { keyPath: 'localKey' })
        attachmentStore.createIndex('scope-ticket-active-created', ['scope', 'ticketId', 'active', 'createdAt', 'id'])
        const mutations = database.createObjectStore(mutationStoreName, { keyPath: 'id' })
        mutations.createIndex('user-workspace-state-created', ['userId', 'workspaceId', 'state', 'createdAt', 'id'])
        mutations.createIndex('user-workspace-ticket-state-created', [
          'userId',
          'workspaceId',
          'ticketId',
          'state',
          'createdAt',
          'id',
        ])
        mutations.createIndex('attachment-id', ['userId', 'workspaceId', 'attachmentId'])
      },
      { once: true },
    )
    request.addEventListener(
      'success',
      () => {
        const database = request.result
        database.addEventListener('versionchange', () => database.close())
        resolve(database)
      },
      { once: true },
    )
    request.addEventListener(
      'error',
      () => {
        databasePromise = null
        reject(request.error ?? new Error('Could not open local attachment storage.'))
      },
      { once: true },
    )
  })
  return databasePromise
}

export async function savePendingTicketAttachment(
  userId: string,
  workspaceId: string,
  ticketId: string,
  attachmentId: string,
  file: File,
): Promise<TicketAttachment> {
  const now = new Date().toISOString()
  const attachment = ticketAttachmentSchema.parse({
    id: attachmentId,
    workspaceId,
    ticketId,
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    checksumSha256: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  const database = await openDatabase()
  const transaction = database.transaction([attachmentStoreName, mutationStoreName], 'readwrite')
  const key = attachmentKey(userId, workspaceId, attachmentId)
  transaction.objectStore(attachmentStoreName).put({
    ...attachment,
    localKey: key,
    scope: scopeKey(userId, workspaceId),
    userId,
    active: 1,
    blob: file,
    syncState: 'pending',
  } satisfies LocalAttachment)
  transaction.objectStore(mutationStoreName).put({
    id: crypto.randomUUID(),
    userId,
    workspaceId,
    ticketId,
    attachmentId,
    kind: 'attachment.upload',
    createdAt: now,
    state: 'pending',
    lastError: null,
    attempts: 0,
  } satisfies AttachmentMutation)
  await transactionDone(transaction)
  return attachment
}

export async function listLocalTicketAttachmentPage(
  userId: string,
  workspaceId: string,
  ticketId: string,
  cursor: TicketAttachmentCursor | null,
): Promise<LocalAttachmentPage> {
  const database = await openDatabase()
  const transaction = database.transaction(attachmentStoreName, 'readonly')
  const index = transaction.objectStore(attachmentStoreName).index('scope-ticket-active-created')
  const scope = scopeKey(userId, workspaceId)
  const lower = cursor ? [scope, ticketId, 1, cursor.createdAt, cursor.id] : [scope, ticketId, 1, '', '']
  const upper = [scope, ticketId, 1, '\uffff', '\uffff']
  const range = IDBKeyRange.bound(lower, upper, Boolean(cursor), false)
  const rows: LocalAttachment[] = []
  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor(range)
    request.addEventListener('success', () => {
      const row = request.result
      if (!row || rows.length > ticketAttachmentPageSize) {
        resolve()
        return
      }
      const value = row.value as LocalAttachment
      rows.push(value)
      if (rows.length > ticketAttachmentPageSize) {
        resolve()
        return
      }
      row.continue()
    })
    request.addEventListener('error', () => reject(request.error ?? new Error('Could not read attachments.')), {
      once: true,
    })
  })
  const hasMore = rows.length > ticketAttachmentPageSize
  const pageRows = rows.slice(0, ticketAttachmentPageSize)
  const tail = pageRows.at(-1)
  await transactionDone(transaction)
  return {
    attachments: pageRows.map((row) => ticketAttachmentSchema.parse(row)),
    localAttachments: pageRows,
    nextCursor: hasMore && tail ? { createdAt: tail.createdAt, id: tail.id } : null,
  }
}

export async function mergeRemoteTicketAttachments(
  userId: string,
  workspaceId: string,
  attachments: TicketAttachment[],
): Promise<TicketAttachment[]> {
  const database = await openDatabase()
  const transaction = database.transaction([attachmentStoreName, mutationStoreName], 'readwrite')
  const rows = transaction.objectStore(attachmentStoreName)
  const mutations = transaction.objectStore(mutationStoreName)
  const visible: TicketAttachment[] = []
  for (const attachment of attachments) {
    const key = attachmentKey(userId, workspaceId, attachment.id)
    const existing = (await requestResult(rows.get(key))) as LocalAttachment | undefined
    if (
      existing &&
      existing.deletedAt !== null &&
      (existing.syncState === 'pending' || existing.syncState === 'failed')
    ) {
      continue
    }
    rows.put({
      ...attachment,
      localKey: key,
      scope: scopeKey(userId, workspaceId),
      userId,
      active: attachment.deletedAt === null ? 1 : 0,
      blob: existing?.blob ?? null,
      syncState: 'synced',
    } satisfies LocalAttachment)
    const mutationKeyRange = IDBKeyRange.only([userId, workspaceId, attachment.id])
    const matching = await requestResult(mutations.index('attachment-id').getAll(mutationKeyRange))
    for (const mutation of matching as AttachmentMutation[]) {
      if (mutation.kind === 'attachment.upload') mutations.delete(mutation.id)
    }
    visible.push(attachment)
  }
  await transactionDone(transaction)
  return visible
}

export async function getPendingTicketAttachmentMutations(
  userId: string,
  workspaceId: string,
): Promise<AttachmentMutation[]> {
  const database = await openDatabase()
  const transaction = database.transaction(mutationStoreName, 'readonly')
  const range = IDBKeyRange.bound(
    [userId, workspaceId, 'pending', '', ''],
    [userId, workspaceId, 'pending', '\uffff', '\uffff'],
  )
  const rows = (await requestResult(
    transaction
      .objectStore(mutationStoreName)
      .index('user-workspace-state-created')
      .getAll(range, ticketAttachmentPageSize),
  )) as AttachmentMutation[]
  await transactionDone(transaction)
  return rows
}

export async function getTicketAttachmentMutationSummary(
  userId: string,
  workspaceId: string,
  ticketId: string,
): Promise<{ hasPendingMutation: boolean; hasFailedMutation: boolean }> {
  const database = await openDatabase()
  const transaction = database.transaction(mutationStoreName, 'readonly')
  const index = transaction.objectStore(mutationStoreName).index('user-workspace-ticket-state-created')
  const pendingRange = IDBKeyRange.bound(
    [userId, workspaceId, ticketId, 'pending', '', ''],
    [userId, workspaceId, ticketId, 'pending', '\uffff', '\uffff'],
  )
  const failedRange = IDBKeyRange.bound(
    [userId, workspaceId, ticketId, 'failed', '', ''],
    [userId, workspaceId, ticketId, 'failed', '\uffff', '\uffff'],
  )
  const [pending, failed] = await Promise.all([
    requestResult(index.getAll(pendingRange, 1)),
    requestResult(index.getAll(failedRange, 1)),
  ])
  await transactionDone(transaction)
  return { hasPendingMutation: pending.length > 0, hasFailedMutation: failed.length > 0 }
}

export async function getLocalTicketAttachmentBlob(
  userId: string,
  workspaceId: string,
  attachmentId: string,
): Promise<Blob | null> {
  const database = await openDatabase()
  const transaction = database.transaction(attachmentStoreName, 'readonly')
  const row = (await requestResult(
    transaction.objectStore(attachmentStoreName).get(attachmentKey(userId, workspaceId, attachmentId)),
  )) as LocalAttachment | undefined
  await transactionDone(transaction)
  return row?.blob ?? null
}

export async function getLocalTicketAttachment(
  userId: string,
  workspaceId: string,
  attachmentId: string,
): Promise<LocalAttachment | null> {
  const database = await openDatabase()
  const transaction = database.transaction(attachmentStoreName, 'readonly')
  const row = (await requestResult(
    transaction.objectStore(attachmentStoreName).get(attachmentKey(userId, workspaceId, attachmentId)),
  )) as LocalAttachment | undefined
  await transactionDone(transaction)
  return row ?? null
}

export async function markTicketAttachmentUploaded(userId: string, workspaceId: string, attachment: TicketAttachment) {
  const database = await openDatabase()
  const transaction = database.transaction([attachmentStoreName, mutationStoreName], 'readwrite')
  const key = attachmentKey(userId, workspaceId, attachment.id)
  const store = transaction.objectStore(attachmentStoreName)
  const existing = (await requestResult(store.get(key))) as LocalAttachment | undefined
  if (existing) {
    store.put({
      ...attachment,
      localKey: key,
      scope: scopeKey(userId, workspaceId),
      userId,
      active: attachment.deletedAt === null ? 1 : 0,
      blob: existing.blob,
      syncState: 'synced',
    } satisfies LocalAttachment)
  }
  await deleteAttachmentMutations(
    transaction.objectStore(mutationStoreName),
    userId,
    workspaceId,
    attachment.id,
    'attachment.upload',
  )
  await transactionDone(transaction)
}

export async function enqueueTicketAttachmentDelete(
  userId: string,
  workspaceId: string,
  ticketId: string,
  attachmentId: string,
) {
  const database = await openDatabase()
  const transaction = database.transaction([attachmentStoreName, mutationStoreName], 'readwrite')
  const key = attachmentKey(userId, workspaceId, attachmentId)
  const store = transaction.objectStore(attachmentStoreName)
  const existing = (await requestResult(store.get(key))) as LocalAttachment | undefined
  if (!existing || existing.deletedAt !== null) {
    transaction.abort()
    throw new Error('Attachment is not available locally.')
  }
  const mutationStore = transaction.objectStore(mutationStoreName)
  const relatedMutations = (await requestResult(
    mutationStore.index('attachment-id').getAll(IDBKeyRange.only([userId, workspaceId, attachmentId])),
  )) as AttachmentMutation[]
  const uploadMutation = relatedMutations.find((mutation) => mutation.kind === 'attachment.upload')
  const now = new Date().toISOString()
  const deleteCreatedAt =
    uploadMutation?.state === 'pending' && uploadMutation.createdAt >= now
      ? new Date(Date.parse(uploadMutation.createdAt) + 1).toISOString()
      : now
  if (uploadMutation?.state === 'failed') mutationStore.delete(uploadMutation.id)
  store.put({
    ...existing,
    active: 0,
    deletedAt: deleteCreatedAt,
    updatedAt: deleteCreatedAt,
    version: existing.version + 1,
    syncState: 'pending',
  })
  mutationStore.put({
    id: crypto.randomUUID(),
    userId,
    workspaceId,
    ticketId,
    attachmentId,
    kind: 'attachment.delete',
    createdAt: deleteCreatedAt,
    state: 'pending',
    lastError: null,
    attempts: 0,
  } satisfies AttachmentMutation)
  await transactionDone(transaction)
}

export async function markTicketAttachmentDeleted(userId: string, workspaceId: string, attachmentId: string) {
  const database = await openDatabase()
  const transaction = database.transaction([attachmentStoreName, mutationStoreName], 'readwrite')
  const mutations = transaction.objectStore(mutationStoreName)
  await deleteAttachmentMutations(mutations, userId, workspaceId, attachmentId, 'attachment.delete')
  const remaining = (await requestResult(
    mutations.index('attachment-id').getAll(IDBKeyRange.only([userId, workspaceId, attachmentId])),
  )) as AttachmentMutation[]
  if (!remaining.some((mutation) => mutation.kind === 'attachment.upload')) {
    const key = attachmentKey(userId, workspaceId, attachmentId)
    const store = transaction.objectStore(attachmentStoreName)
    const existing = (await requestResult(store.get(key))) as LocalAttachment | undefined
    if (existing) store.put({ ...existing, syncState: 'synced' })
  }
  await transactionDone(transaction)
}

export async function failTicketAttachmentMutation(
  userId: string,
  workspaceId: string,
  mutation: AttachmentMutation,
  message: string,
) {
  const database = await openDatabase()
  const transaction = database.transaction([attachmentStoreName, mutationStoreName], 'readwrite')
  transaction
    .objectStore(mutationStoreName)
    .put({ ...mutation, state: 'failed', lastError: message, attempts: mutation.attempts + 1 })
  const key = attachmentKey(userId, workspaceId, mutation.attachmentId)
  const store = transaction.objectStore(attachmentStoreName)
  const existing = (await requestResult(store.get(key))) as LocalAttachment | undefined
  if (existing) store.put({ ...existing, syncState: 'failed' })
  await transactionDone(transaction)
}

export async function retryTicketAttachmentMutations(userId: string, workspaceId: string, ticketId: string) {
  const database = await openDatabase()
  const transaction = database.transaction(mutationStoreName, 'readwrite')
  const index = transaction.objectStore(mutationStoreName).index('user-workspace-ticket-state-created')
  const range = IDBKeyRange.bound(
    [userId, workspaceId, ticketId, 'failed', '', ''],
    [userId, workspaceId, ticketId, 'failed', '\uffff', '\uffff'],
  )
  const mutations = (await requestResult(index.getAll(range, ticketAttachmentPageSize))) as AttachmentMutation[]
  for (const mutation of mutations) {
    transaction.objectStore(mutationStoreName).put({ ...mutation, state: 'pending', lastError: null })
  }
  await transactionDone(transaction)
}

async function deleteAttachmentMutations(
  store: IDBObjectStore,
  userId: string,
  workspaceId: string,
  attachmentId: string,
  kind: AttachmentMutation['kind'],
) {
  const rows = (await requestResult(
    store.index('attachment-id').getAll(IDBKeyRange.only([userId, workspaceId, attachmentId])),
  )) as AttachmentMutation[]
  for (const row of rows) if (row.kind === kind) store.delete(row.id)
}
