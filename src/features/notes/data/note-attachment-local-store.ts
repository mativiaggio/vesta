import {
  noteAttachmentPageSize,
  noteAttachmentSchema,
  type NoteAttachment,
  type NoteAttachmentCursor,
  type NoteAttachmentPage,
} from '../../../../packages/notes/src/attachment-contract'

const databaseName = 'vesta-note-attachments'
const databaseVersion = 2
const attachmentsStore = 'attachments'
const mutationsStore = 'mutations'
type SyncState = 'local' | 'pending' | 'synced' | 'failed'

type LocalNoteAttachment = NoteAttachment & {
  localKey: string
  scope: string
  userId: string
  active: 0 | 1
  blob: Blob | null
  syncState: SyncState
}

export type NoteAttachmentMutation = {
  id: string
  userId: string
  workspaceId: string
  noteId: string
  attachmentId: string
  kind: 'attachment.upload' | 'attachment.delete'
  createdAt: string
  state: 'pending' | 'syncing' | 'failed'
  lastError: string | null
  attempts: number
}

type LocalAttachmentPage = NoteAttachmentPage & { localAttachments: LocalNoteAttachment[] }
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
    request.addEventListener('error', () => reject(request.error ?? new Error('Note attachment storage failed.')), {
      once: true,
    })
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('Note attachment storage failed.')),
      {
        once: true,
      },
    )
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('Note attachment storage failed.')),
      {
        once: true,
      },
    )
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
        const transaction = request.transaction
        if (!transaction) return
        const attachments = database.objectStoreNames.contains(attachmentsStore)
          ? transaction.objectStore(attachmentsStore)
          : database.createObjectStore(attachmentsStore, { keyPath: 'localKey' })
        if (!attachments.indexNames.contains('scope-note-active-created')) {
          attachments.createIndex('scope-note-active-created', ['scope', 'noteId', 'active', 'createdAt', 'id'])
        }
        if (!attachments.indexNames.contains('scope-note-created')) {
          attachments.createIndex('scope-note-created', ['scope', 'noteId', 'createdAt', 'id'])
        }
        const mutations = database.objectStoreNames.contains(mutationsStore)
          ? transaction.objectStore(mutationsStore)
          : database.createObjectStore(mutationsStore, { keyPath: 'id' })
        if (!mutations.indexNames.contains('user-workspace-state-created')) {
          mutations.createIndex('user-workspace-state-created', ['userId', 'workspaceId', 'state', 'createdAt', 'id'])
        }
        if (!mutations.indexNames.contains('attachment-id')) {
          mutations.createIndex('attachment-id', ['userId', 'workspaceId', 'attachmentId'])
        }
        if (!mutations.indexNames.contains('note-id')) {
          mutations.createIndex('note-id', ['userId', 'workspaceId', 'noteId'])
        }
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
        reject(request.error ?? new Error('Could not open local note attachment storage.'))
      },
      { once: true },
    )
  })
  return databasePromise
}

async function relatedMutations(
  store: IDBObjectStore,
  userId: string,
  workspaceId: string,
  attachmentId: string,
): Promise<NoteAttachmentMutation[]> {
  return (await requestResult(
    store.index('attachment-id').getAll(IDBKeyRange.only([userId, workspaceId, attachmentId])),
  )) as NoteAttachmentMutation[]
}

export async function savePendingNoteAttachment(
  userId: string,
  workspaceId: string,
  noteId: string,
  file: File,
): Promise<NoteAttachment> {
  const now = new Date().toISOString()
  const attachment = noteAttachmentSchema.parse({
    id: crypto.randomUUID(),
    workspaceId,
    noteId,
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
  const transaction = database.transaction([attachmentsStore, mutationsStore], 'readwrite')
  transaction.objectStore(attachmentsStore).put({
    ...attachment,
    localKey: attachmentKey(userId, workspaceId, attachment.id),
    scope: scopeKey(userId, workspaceId),
    userId,
    active: 1,
    blob: file,
    syncState: 'pending',
  } satisfies LocalNoteAttachment)
  transaction.objectStore(mutationsStore).add({
    id: crypto.randomUUID(),
    userId,
    workspaceId,
    noteId,
    attachmentId: attachment.id,
    kind: 'attachment.upload',
    createdAt: now,
    state: 'pending',
    lastError: null,
    attempts: 0,
  } satisfies NoteAttachmentMutation)
  await transactionDone(transaction)
  return attachment
}

export async function listLocalNoteAttachmentPage(
  userId: string,
  workspaceId: string,
  noteId: string,
  cursor: NoteAttachmentCursor | null,
): Promise<LocalAttachmentPage> {
  const database = await openDatabase()
  const transaction = database.transaction(attachmentsStore, 'readonly')
  const index = transaction.objectStore(attachmentsStore).index('scope-note-active-created')
  const scope = scopeKey(userId, workspaceId)
  const lower = cursor ? [scope, noteId, 1, cursor.createdAt, cursor.id] : [scope, noteId, 1, '', '']
  const upper = [scope, noteId, 1, '\uffff', '\uffff']
  const range = IDBKeyRange.bound(lower, upper, Boolean(cursor), false)
  const rows: LocalNoteAttachment[] = []
  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor(range)
    request.addEventListener('success', () => {
      const row = request.result
      if (!row || rows.length > noteAttachmentPageSize) {
        resolve()
        return
      }
      rows.push(row.value as LocalNoteAttachment)
      if (rows.length > noteAttachmentPageSize) resolve()
      else row.continue()
    })
    request.addEventListener('error', () => reject(request.error ?? new Error('Could not read note attachments.')), {
      once: true,
    })
  })
  const hasMore = rows.length > noteAttachmentPageSize
  const pageRows = rows.slice(0, noteAttachmentPageSize)
  const tail = pageRows.at(-1)
  await transactionDone(transaction)
  return {
    attachments: pageRows.map((attachment) => noteAttachmentSchema.parse(attachment)),
    localAttachments: pageRows,
    nextCursor: hasMore && tail ? { createdAt: tail.createdAt, id: tail.id } : null,
  }
}

export async function mergeRemoteNoteAttachments(
  userId: string,
  workspaceId: string,
  attachments: NoteAttachment[],
): Promise<NoteAttachment[]> {
  const database = await openDatabase()
  const transaction = database.transaction([attachmentsStore, mutationsStore], 'readwrite')
  const rows = transaction.objectStore(attachmentsStore)
  const mutations = transaction.objectStore(mutationsStore)
  for (const attachment of attachments) {
    const key = attachmentKey(userId, workspaceId, attachment.id)
    const existing = (await requestResult(rows.get(key))) as LocalNoteAttachment | undefined
    const related = await relatedMutations(mutations, userId, workspaceId, attachment.id)
    if (existing && related.some((mutation) => mutation.kind === 'attachment.delete')) continue
    rows.put({
      ...attachment,
      localKey: key,
      scope: scopeKey(userId, workspaceId),
      userId,
      active: attachment.deletedAt === null ? 1 : 0,
      blob: existing?.blob ?? null,
      syncState: 'synced',
    } satisfies LocalNoteAttachment)
    for (const mutation of related) {
      if (mutation.kind === 'attachment.upload') mutations.delete(mutation.id)
    }
  }
  await transactionDone(transaction)
  return attachments
}

export async function getPendingNoteAttachmentMutations(
  userId: string,
  workspaceId: string,
): Promise<NoteAttachmentMutation[]> {
  const database = await openDatabase()
  const transaction = database.transaction(mutationsStore, 'readonly')
  const range = IDBKeyRange.bound(
    [userId, workspaceId, 'pending', '', ''],
    [userId, workspaceId, 'pending', '\uffff', '\uffff'],
  )
  const rows = (await requestResult(
    transaction.objectStore(mutationsStore).index('user-workspace-state-created').getAll(range, 50),
  )) as NoteAttachmentMutation[]
  await transactionDone(transaction)
  return rows
}

export async function recoverInterruptedNoteAttachmentMutations(userId: string, workspaceId: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(mutationsStore, 'readwrite')
  const range = IDBKeyRange.bound(
    [userId, workspaceId, 'syncing', '', ''],
    [userId, workspaceId, 'syncing', '\uffff', '\uffff'],
  )
  const store = transaction.objectStore(mutationsStore)
  const rows = (await requestResult(
    store.index('user-workspace-state-created').getAll(range, 50),
  )) as NoteAttachmentMutation[]
  for (const mutation of rows) store.put({ ...mutation, state: 'pending' } satisfies NoteAttachmentMutation)
  await transactionDone(transaction)
}

export async function markNoteAttachmentMutationSyncing(mutation: NoteAttachmentMutation): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(mutationsStore, 'readwrite')
  transaction.objectStore(mutationsStore).put({ ...mutation, state: 'syncing' } satisfies NoteAttachmentMutation)
  await transactionDone(transaction)
}

export async function discardLocalNoteAttachmentsForNote(
  userId: string,
  workspaceId: string,
  noteId: string,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([attachmentsStore, mutationsStore], 'readwrite')
  const attachmentStore = transaction.objectStore(attachmentsStore)
  const attachmentRange = IDBKeyRange.bound(
    [scopeKey(userId, workspaceId), noteId, '', ''],
    [scopeKey(userId, workspaceId), noteId, '\uffff', '\uffff'],
  )
  const localRows = (await requestResult(
    attachmentStore.index('scope-note-created').getAll(attachmentRange),
  )) as LocalNoteAttachment[]
  for (const attachment of localRows) attachmentStore.delete(attachment.localKey)
  const mutationStore = transaction.objectStore(mutationsStore)
  const mutations = (await requestResult(
    mutationStore.index('note-id').getAll(IDBKeyRange.only([userId, workspaceId, noteId])),
  )) as NoteAttachmentMutation[]
  for (const mutation of mutations) mutationStore.delete(mutation.id)
  await transactionDone(transaction)
}

export async function getLocalNoteAttachmentBlob(
  userId: string,
  workspaceId: string,
  attachmentId: string,
): Promise<Blob | null> {
  const database = await openDatabase()
  const transaction = database.transaction(attachmentsStore, 'readonly')
  const row = (await requestResult(
    transaction.objectStore(attachmentsStore).get(attachmentKey(userId, workspaceId, attachmentId)),
  )) as LocalNoteAttachment | undefined
  await transactionDone(transaction)
  return row?.blob ?? null
}

export async function getLocalNoteAttachment(
  userId: string,
  workspaceId: string,
  attachmentId: string,
): Promise<LocalNoteAttachment | null> {
  const database = await openDatabase()
  const transaction = database.transaction(attachmentsStore, 'readonly')
  const row = (await requestResult(
    transaction.objectStore(attachmentsStore).get(attachmentKey(userId, workspaceId, attachmentId)),
  )) as LocalNoteAttachment | undefined
  await transactionDone(transaction)
  return row ?? null
}

export async function markNoteAttachmentUploaded(
  userId: string,
  workspaceId: string,
  attachment: NoteAttachment,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([attachmentsStore, mutationsStore], 'readwrite')
  const key = attachmentKey(userId, workspaceId, attachment.id)
  const store = transaction.objectStore(attachmentsStore)
  const existing = (await requestResult(store.get(key))) as LocalNoteAttachment | undefined
  const related = await relatedMutations(transaction.objectStore(mutationsStore), userId, workspaceId, attachment.id)
  const hasPendingDelete = related.some((mutation) => mutation.kind === 'attachment.delete')
  if (existing) {
    store.put({
      ...attachment,
      localKey: key,
      scope: scopeKey(userId, workspaceId),
      userId,
      deletedAt: hasPendingDelete ? (existing.deletedAt ?? attachment.deletedAt) : attachment.deletedAt,
      active: hasPendingDelete ? 0 : attachment.deletedAt === null ? 1 : 0,
      blob: existing.blob,
      syncState: hasPendingDelete ? 'pending' : 'synced',
    } satisfies LocalNoteAttachment)
  }
  for (const mutation of related)
    if (mutation.kind === 'attachment.upload') transaction.objectStore(mutationsStore).delete(mutation.id)
  await transactionDone(transaction)
}

export async function enqueueNoteAttachmentDelete(
  userId: string,
  workspaceId: string,
  noteId: string,
  attachmentId: string,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([attachmentsStore, mutationsStore], 'readwrite')
  const attachments = transaction.objectStore(attachmentsStore)
  const mutations = transaction.objectStore(mutationsStore)
  const key = attachmentKey(userId, workspaceId, attachmentId)
  const existing = (await requestResult(attachments.get(key))) as LocalNoteAttachment | undefined
  if (!existing || existing.deletedAt !== null) {
    transaction.abort()
    throw new Error('Attachment is not available locally.')
  }
  const related = await relatedMutations(mutations, userId, workspaceId, attachmentId)
  const pendingUpload = related.find(
    (mutation) => mutation.kind === 'attachment.upload' && mutation.state !== 'syncing',
  )
  const now = new Date().toISOString()
  if (pendingUpload) {
    for (const mutation of related) mutations.delete(mutation.id)
    attachments.delete(key)
    await transactionDone(transaction)
    return
  }
  mutations.add({
    id: crypto.randomUUID(),
    userId,
    workspaceId,
    noteId,
    attachmentId,
    kind: 'attachment.delete',
    createdAt: now,
    state: 'pending',
    lastError: null,
    attempts: 0,
  } satisfies NoteAttachmentMutation)
  attachments.put({
    ...existing,
    deletedAt: now,
    updatedAt: now,
    active: 0,
    syncState: 'pending',
  } satisfies LocalNoteAttachment)
  await transactionDone(transaction)
}

export async function markNoteAttachmentDeleted(
  userId: string,
  workspaceId: string,
  attachmentId: string,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([attachmentsStore, mutationsStore], 'readwrite')
  const key = attachmentKey(userId, workspaceId, attachmentId)
  const attachment = (await requestResult(transaction.objectStore(attachmentsStore).get(key))) as
    LocalNoteAttachment | undefined
  if (attachment) {
    transaction
      .objectStore(attachmentsStore)
      .put({ ...attachment, active: 0, syncState: 'synced' } satisfies LocalNoteAttachment)
  }
  const related = await relatedMutations(transaction.objectStore(mutationsStore), userId, workspaceId, attachmentId)
  for (const mutation of related)
    if (mutation.kind === 'attachment.delete') transaction.objectStore(mutationsStore).delete(mutation.id)
  await transactionDone(transaction)
}

export async function failNoteAttachmentMutation(
  mutation: NoteAttachmentMutation,
  message: string,
  permanent: boolean,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([attachmentsStore, mutationsStore], 'readwrite')
  transaction.objectStore(mutationsStore).put({
    ...mutation,
    attempts: mutation.attempts + 1,
    lastError: message,
    state: permanent ? 'failed' : 'pending',
  } satisfies NoteAttachmentMutation)
  const key = attachmentKey(mutation.userId, mutation.workspaceId, mutation.attachmentId)
  const attachment = (await requestResult(transaction.objectStore(attachmentsStore).get(key))) as
    LocalNoteAttachment | undefined
  if (attachment)
    transaction
      .objectStore(attachmentsStore)
      .put({ ...attachment, syncState: permanent ? 'failed' : 'pending' } satisfies LocalNoteAttachment)
  await transactionDone(transaction)
}

export async function retryNoteAttachmentMutations(userId: string, workspaceId: string, noteId: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(mutationsStore, 'readwrite')
  const range = IDBKeyRange.bound(
    [userId, workspaceId, 'failed', '', ''],
    [userId, workspaceId, 'failed', '\uffff', '\uffff'],
  )
  const store = transaction.objectStore(mutationsStore)
  const rows = (await requestResult(
    store.index('user-workspace-state-created').getAll(range),
  )) as NoteAttachmentMutation[]
  for (const mutation of rows)
    if (mutation.noteId === noteId)
      store.put({ ...mutation, state: 'pending', lastError: null } satisfies NoteAttachmentMutation)
  await transactionDone(transaction)
}

export async function getNoteAttachmentMutationSummary(
  userId: string,
  workspaceId: string,
  noteId: string,
): Promise<{ hasPendingMutation: boolean; hasFailedMutation: boolean }> {
  const database = await openDatabase()
  const transaction = database.transaction(mutationsStore, 'readonly')
  const range = IDBKeyRange.bound(
    [userId, workspaceId, 'pending', '', ''],
    [userId, workspaceId, 'pending', '\uffff', '\uffff'],
  )
  const failedRange = IDBKeyRange.bound(
    [userId, workspaceId, 'failed', '', ''],
    [userId, workspaceId, 'failed', '\uffff', '\uffff'],
  )
  const index = transaction.objectStore(mutationsStore).index('user-workspace-state-created')
  const [pending, failed] = await Promise.all([
    requestResult(index.getAll(range)),
    requestResult(index.getAll(failedRange)),
  ])
  await transactionDone(transaction)
  const pendingRows = pending as NoteAttachmentMutation[]
  const failedRows = failed as NoteAttachmentMutation[]
  return {
    hasPendingMutation: pendingRows.some((mutation) => mutation.noteId === noteId),
    hasFailedMutation: failedRows.some((mutation) => mutation.noteId === noteId),
  }
}
