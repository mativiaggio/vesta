import {
  noteCursorSchema,
  noteListFiltersSchema,
  notePageSize,
  noteSchema,
  type CreateNoteMutation,
  type DeleteNoteMutation,
  type Note,
  type NoteCursor,
  type NoteListFilters,
  type UpdateNoteMutation,
} from '../../../../packages/notes/src/contract'
import { z } from 'zod'

const databaseName = 'vesta-notes'
const databaseVersion = 1
const notesStore = 'notes'
const mutationsStore = 'mutations'
const metadataStore = 'metadata'

type SyncState = 'local' | 'pending' | 'synced' | 'failed'
export type NoteConflictKind = 'note.update' | 'note.delete'
export type LocalNoteView = Note & { conflict?: { kind: NoteConflictKind; remote: Note } | null }
type LocalNote = Note & {
  localKey: string
  scope: string
  userId: string
  active: 0 | 1
  syncState: SyncState
  serverVersion: number
  remoteConflict?: Note | null
  conflictKind?: NoteConflictKind | null
}
type MutationBase = {
  id: string
  userId: string
  workspaceId: string
  noteId: string
  createdAt: string
  attempts: number
  lastError: string | null
  state: 'pending' | 'syncing' | 'failed'
}
export type NoteMutation = MutationBase &
  (
    | { kind: 'note.create'; payload: CreateNoteMutation }
    | { kind: 'note.update'; payload: UpdateNoteMutation }
    | { kind: 'note.delete'; payload: DeleteNoteMutation }
  )
type NoteUpdateMutation = Extract<NoteMutation, { kind: 'note.update' }>

function isPendingUpdate(mutation: NoteMutation): mutation is NoteUpdateMutation {
  return mutation.kind === 'note.update' && mutation.state === 'pending'
}

export type NotePageSnapshot = {
  notes: LocalNoteView[]
  nextCursor: NoteCursor | null
  pendingCount: number
  hasFailedMutations: boolean
  hasLocalData: boolean
  hasCompleteReplica: boolean
}

const metadataSchema = z.object({ scope: z.string(), hydratedAt: z.string().datetime() })
type ReplicaMetadata = z.infer<typeof metadataSchema>

let databasePromise: Promise<IDBDatabase> | null = null

function scopeKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`
}

function localKey(userId: string, workspaceId: string, noteId: string): string {
  return `${scopeKey(userId, workspaceId)}:${noteId}`
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error ?? new Error('Note storage request failed.')), {
      once: true,
    })
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('Note storage failed.')), {
      once: true,
    })
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('Note storage failed.')), {
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
        const notes = database.createObjectStore(notesStore, { keyPath: 'localKey' })
        notes.createIndex('scope-active-created', ['scope', 'active', 'createdAt', 'id'])
        notes.createIndex('scope-ticket-active-created', ['scope', 'ticketId', 'active', 'createdAt', 'id'])
        const mutations = database.createObjectStore(mutationsStore, { keyPath: 'id' })
        mutations.createIndex('user-workspace-state-created', ['userId', 'workspaceId', 'state', 'createdAt', 'id'])
        mutations.createIndex('note-id', ['userId', 'workspaceId', 'noteId'])
        database.createObjectStore(metadataStore, { keyPath: 'scope' })
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
        reject(request.error ?? new Error('Could not open local note storage.'))
      },
      { once: true },
    )
  })
  return databasePromise
}

async function readMutationsForNote(
  store: IDBObjectStore,
  userId: string,
  workspaceId: string,
  noteId: string,
): Promise<NoteMutation[]> {
  return (await requestResult(
    store.index('note-id').getAll(IDBKeyRange.only([userId, workspaceId, noteId])),
  )) as NoteMutation[]
}

export async function loadLocalNotePage(
  userId: string,
  workspaceId: string,
  cursor: NoteCursor | null,
  filters: NoteListFilters,
): Promise<NotePageSnapshot> {
  const parsedFilters = noteListFiltersSchema.parse(filters)
  const database = await openDatabase()
  const transaction = database.transaction([notesStore, mutationsStore, metadataStore], 'readonly')
  const scope = scopeKey(userId, workspaceId)
  const index = transaction
    .objectStore(notesStore)
    .index(parsedFilters.ticketId === null ? 'scope-active-created' : 'scope-ticket-active-created')
  const lower =
    parsedFilters.ticketId === null
      ? cursor
        ? [scope, 1, '', '']
        : [scope, 1, '', '']
      : cursor
        ? [scope, parsedFilters.ticketId, 1, '', '']
        : [scope, parsedFilters.ticketId, 1, '', '']
  const upper =
    parsedFilters.ticketId === null
      ? cursor
        ? [scope, 1, cursor.createdAt, cursor.id]
        : [scope, 1, '\uffff', '\uffff']
      : cursor
        ? [scope, parsedFilters.ticketId, 1, cursor.createdAt, cursor.id]
        : [scope, parsedFilters.ticketId, 1, '\uffff', '\uffff']
  const range = IDBKeyRange.bound(lower, upper)
  const rows: LocalNote[] = []
  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor(range, 'prev')
    request.addEventListener('success', () => {
      const row = request.result
      if (!row || rows.length > notePageSize) {
        resolve()
        return
      }
      const value = row.value as LocalNote
      if (cursor && value.createdAt === cursor.createdAt && value.id === cursor.id) {
        row.continue()
        return
      }
      rows.push(value)
      if (rows.length > notePageSize) {
        resolve()
        return
      }
      row.continue()
    })
    request.addEventListener('error', () => reject(request.error ?? new Error('Could not read local notes.')), {
      once: true,
    })
  })
  const hasMore = rows.length > notePageSize
  const pageRows = rows.slice(0, notePageSize)
  const tail = pageRows.at(-1)
  const mutations = transaction.objectStore(mutationsStore)
  const pendingRange = IDBKeyRange.bound(
    [userId, workspaceId, 'pending', '', ''],
    [userId, workspaceId, 'pending', '\uffff', '\uffff'],
  )
  const failedRange = IDBKeyRange.bound(
    [userId, workspaceId, 'failed', '', ''],
    [userId, workspaceId, 'failed', '\uffff', '\uffff'],
  )
  const [pendingCount, failedCount, metadata] = await Promise.all([
    requestResult(mutations.index('user-workspace-state-created').getAll(pendingRange, 1)).then(
      (rows: unknown[]) => rows.length,
    ),
    requestResult(mutations.index('user-workspace-state-created').getAll(failedRange, 1)).then(
      (rows: unknown[]) => rows.length,
    ),
    requestResult(transaction.objectStore(metadataStore).get(scope)).then((row: unknown) => row),
  ])
  await transactionDone(transaction)
  const parsedMetadata = metadata === undefined ? null : metadataSchema.parse(metadata)
  return {
    notes: pageRows.map((note) => {
      const parsed = noteSchema.parse(note)
      return note.remoteConflict && note.conflictKind
        ? { ...parsed, conflict: { kind: note.conflictKind, remote: note.remoteConflict } }
        : parsed
    }),
    nextCursor: hasMore && tail ? noteCursorSchema.parse({ createdAt: tail.createdAt, id: tail.id }) : null,
    pendingCount,
    hasFailedMutations: failedCount > 0,
    hasLocalData: pageRows.length > 0,
    hasCompleteReplica: parsedMetadata?.scope === scope,
  }
}

export async function enqueueNoteCreation(
  userId: string,
  workspaceId: string,
  input: Omit<CreateNoteMutation, 'id' | 'clientMutationId'>,
  ticket: Note['ticket'],
): Promise<Note> {
  const now = new Date().toISOString()
  const noteId = crypto.randomUUID()
  const payload = { ...input, id: noteId, clientMutationId: crypto.randomUUID() }
  const local = noteSchema.parse({
    id: noteId,
    workspaceId,
    ticketId: input.ticketId,
    title: input.title,
    content: input.content,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdByUserId: userId,
    updatedByUserId: userId,
    deletedByUserId: null,
    ticket,
  })
  const database = await openDatabase()
  const transaction = database.transaction([notesStore, mutationsStore], 'readwrite')
  transaction.objectStore(notesStore).put({
    ...local,
    localKey: localKey(userId, workspaceId, noteId),
    scope: scopeKey(userId, workspaceId),
    userId,
    active: 1,
    syncState: 'pending',
    serverVersion: 0,
  } satisfies LocalNote)
  transaction.objectStore(mutationsStore).add({
    id: payload.clientMutationId,
    userId,
    workspaceId,
    noteId,
    kind: 'note.create',
    payload,
    createdAt: now,
    attempts: 0,
    lastError: null,
    state: 'pending',
  } satisfies NoteMutation)
  await transactionDone(transaction)
  return local
}

export async function enqueueNoteUpdate(
  userId: string,
  workspaceId: string,
  noteId: string,
  changes: Pick<UpdateNoteMutation, 'ticketId' | 'title' | 'content'>,
  ticket: Note['ticket'],
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([notesStore, mutationsStore], 'readwrite')
  const notes = transaction.objectStore(notesStore)
  const mutations = transaction.objectStore(mutationsStore)
  const key = localKey(userId, workspaceId, noteId)
  const existing = (await requestResult(notes.get(key))) as LocalNote | undefined
  if (!existing || existing.deletedAt !== null) {
    transaction.abort()
    throw new Error('Note is not available locally.')
  }
  const related = await readMutationsForNote(mutations, userId, workspaceId, noteId)
  const pendingUpdate = related.find(isPendingUpdate)
  const expectedVersion = pendingUpdate?.payload.expectedVersion ?? Math.max(1, existing.serverVersion)
  const payload: UpdateNoteMutation = {
    ...(pendingUpdate?.payload.ticketId === undefined ? {} : { ticketId: pendingUpdate.payload.ticketId }),
    ...(pendingUpdate?.payload.title === undefined ? {} : { title: pendingUpdate.payload.title }),
    ...(pendingUpdate?.payload.content === undefined ? {} : { content: pendingUpdate.payload.content }),
    ...changes,
    expectedVersion,
    clientMutationId: crypto.randomUUID(),
  }
  const now = new Date().toISOString()
  if (pendingUpdate) mutations.delete(pendingUpdate.id)
  mutations.add({
    id: payload.clientMutationId,
    userId,
    workspaceId,
    noteId,
    kind: 'note.update',
    payload,
    createdAt: pendingUpdate?.createdAt ?? now,
    attempts: 0,
    lastError: null,
    state: 'pending',
  } satisfies NoteMutation)
  notes.put({
    ...existing,
    ...(changes.ticketId === undefined ? {} : { ticketId: changes.ticketId }),
    ...(changes.title === undefined ? {} : { title: changes.title }),
    ...(changes.content === undefined ? {} : { content: changes.content }),
    ticket,
    version: existing.version + 1,
    updatedAt: now,
    syncState: 'pending',
  } satisfies LocalNote)
  await transactionDone(transaction)
}

export async function enqueueNoteDeletion(
  userId: string,
  workspaceId: string,
  noteId: string,
): Promise<{ deletedAt: string; canceledBeforeSync: boolean }> {
  const database = await openDatabase()
  const transaction = database.transaction([notesStore, mutationsStore], 'readwrite')
  const notes = transaction.objectStore(notesStore)
  const mutations = transaction.objectStore(mutationsStore)
  const completed = transactionDone(transaction)
  void completed.catch(() => undefined)
  const key = localKey(userId, workspaceId, noteId)
  const existing = (await requestResult(notes.get(key))) as LocalNote | undefined
  if (!existing) {
    transaction.abort()
    throw new Error('Note is not available locally.')
  }
  if (existing.deletedAt !== null) {
    await completed
    return { deletedAt: existing.deletedAt, canceledBeforeSync: existing.syncState === 'local' }
  }
  const related = await readMutationsForNote(mutations, userId, workspaceId, noteId)
  const pendingCreate = related.find(
    (mutation) => mutation.kind === 'note.create' && (mutation.state === 'pending' || mutation.state === 'failed'),
  )
  if (pendingCreate && existing.serverVersion === 0) {
    for (const mutation of related) mutations.delete(mutation.id)
    const now = new Date().toISOString()
    notes.put({ ...existing, deletedAt: now, updatedAt: now, active: 0, syncState: 'local' } satisfies LocalNote)
    await completed
    return { deletedAt: now, canceledBeforeSync: true }
  }
  const pendingMutationCount = related.filter(
    (mutation) => mutation.kind === 'note.update' && mutation.state !== 'failed',
  ).length
  const expectedVersion = Math.max(1, existing.serverVersion) + pendingMutationCount
  const now = new Date().toISOString()
  const payload: DeleteNoteMutation = { expectedVersion, clientMutationId: crypto.randomUUID() }
  mutations.add({
    id: payload.clientMutationId,
    userId,
    workspaceId,
    noteId,
    kind: 'note.delete',
    payload,
    createdAt: now,
    attempts: 0,
    lastError: null,
    state: 'pending',
  } satisfies NoteMutation)
  notes.put({ ...existing, deletedAt: now, updatedAt: now, active: 0, syncState: 'pending' } satisfies LocalNote)
  await completed
  return { deletedAt: now, canceledBeforeSync: false }
}

export async function listPendingNoteMutations(userId: string, workspaceId: string): Promise<NoteMutation[]> {
  const database = await openDatabase()
  const transaction = database.transaction(mutationsStore, 'readonly')
  const range = IDBKeyRange.bound(
    [userId, workspaceId, 'pending', '', ''],
    [userId, workspaceId, 'pending', '\uffff', '\uffff'],
  )
  const rows = (await requestResult(
    transaction.objectStore(mutationsStore).index('user-workspace-state-created').getAll(range, 50),
  )) as NoteMutation[]
  await transactionDone(transaction)
  return rows
}

export async function recoverInterruptedNoteMutations(userId: string, workspaceId: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(mutationsStore, 'readwrite')
  const range = IDBKeyRange.bound(
    [userId, workspaceId, 'syncing', '', ''],
    [userId, workspaceId, 'syncing', '\uffff', '\uffff'],
  )
  const store = transaction.objectStore(mutationsStore)
  const interrupted = (await requestResult(store.index('user-workspace-state-created').getAll(range))) as NoteMutation[]
  for (const mutation of interrupted) store.put({ ...mutation, state: 'pending' } satisfies NoteMutation)
  await transactionDone(transaction)
}

export async function markNoteMutationSyncing(mutation: NoteMutation): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(mutationsStore, 'readwrite')
  transaction.objectStore(mutationsStore).put({ ...mutation, state: 'syncing' } satisfies NoteMutation)
  await transactionDone(transaction)
}

export async function completeNoteMutation(mutation: NoteMutation, saved: Note): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([notesStore, mutationsStore], 'readwrite')
  const notes = transaction.objectStore(notesStore)
  const mutations = transaction.objectStore(mutationsStore)
  const key = localKey(mutation.userId, mutation.workspaceId, mutation.noteId)
  const existing = (await requestResult(notes.get(key))) as LocalNote | undefined
  mutations.delete(mutation.id)
  const related = await readMutationsForNote(mutations, mutation.userId, mutation.workspaceId, mutation.noteId)
  const stillDirty = related.some((row) => row.id !== mutation.id && row.kind !== 'note.delete')
  if (existing) {
    const pendingUpdate = related.find(isPendingUpdate)
    if (pendingUpdate) {
      const rebased: NoteMutation = {
        ...pendingUpdate,
        id: crypto.randomUUID(),
        payload: { ...pendingUpdate.payload, expectedVersion: saved.version, clientMutationId: crypto.randomUUID() },
      }
      mutations.delete(pendingUpdate.id)
      mutations.add(rebased)
    }
    const remoteFields = {
      ...saved,
      ...(stillDirty ? { title: existing.title, content: existing.content, ticketId: existing.ticketId } : {}),
    }
    notes.put({
      ...remoteFields,
      localKey: key,
      scope: scopeKey(mutation.userId, mutation.workspaceId),
      userId: mutation.userId,
      active: existing.deletedAt === null ? 1 : 0,
      syncState: stillDirty ? 'pending' : 'synced',
      serverVersion: saved.version,
    } satisfies LocalNote)
  }
  await transactionDone(transaction)
}

export async function completeNoteDeletion(mutation: NoteMutation, deletedAt: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([notesStore, mutationsStore], 'readwrite')
  const note = (await requestResult(
    transaction.objectStore(notesStore).get(localKey(mutation.userId, mutation.workspaceId, mutation.noteId)),
  )) as LocalNote | undefined
  transaction.objectStore(mutationsStore).delete(mutation.id)
  if (note) {
    transaction.objectStore(notesStore).put({
      ...note,
      deletedAt,
      updatedAt: deletedAt,
      active: 0,
      syncState: 'synced',
      serverVersion: note.serverVersion + 1,
    } satisfies LocalNote)
  }
  await transactionDone(transaction)
}

export async function recordNoteMutationFailure(
  mutation: NoteMutation,
  message: string,
  permanent: boolean,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([notesStore, mutationsStore], 'readwrite')
  transaction.objectStore(mutationsStore).put({
    ...mutation,
    attempts: mutation.attempts + 1,
    lastError: message,
    state: permanent ? 'failed' : 'pending',
  } satisfies NoteMutation)
  const key = localKey(mutation.userId, mutation.workspaceId, mutation.noteId)
  const note = (await requestResult(transaction.objectStore(notesStore).get(key))) as LocalNote | undefined
  if (note)
    transaction
      .objectStore(notesStore)
      .put({ ...note, syncState: permanent ? 'failed' : 'pending' } satisfies LocalNote)
  await transactionDone(transaction)
}

export async function recordNoteVersionConflict(
  mutation: Extract<NoteMutation, { kind: 'note.update' | 'note.delete' }>,
  remote: Note,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([notesStore, mutationsStore], 'readwrite')
  const noteStore = transaction.objectStore(notesStore)
  const mutationStore = transaction.objectStore(mutationsStore)
  mutationStore.put({
    ...mutation,
    attempts: mutation.attempts + 1,
    lastError: 'version-conflict',
    state: 'failed',
  } satisfies NoteMutation)
  const key = localKey(mutation.userId, mutation.workspaceId, mutation.noteId)
  const existing = (await requestResult(noteStore.get(key))) as LocalNote | undefined
  if (existing) {
    if (mutation.kind === 'note.delete') {
      noteStore.put({
        ...remote,
        localKey: key,
        scope: scopeKey(mutation.userId, mutation.workspaceId),
        userId: mutation.userId,
        active: remote.deletedAt === null ? 1 : 0,
        syncState: 'failed',
        serverVersion: remote.version,
        remoteConflict: remote,
        conflictKind: 'note.delete',
      } satisfies LocalNote)
    } else {
      noteStore.put({
        ...existing,
        syncState: 'failed',
        serverVersion: remote.version,
        remoteConflict: remote,
        conflictKind: 'note.update',
      } satisfies LocalNote)
    }
  }
  await transactionDone(transaction)
}

export async function resolveNoteConflictWithRemote(
  userId: string,
  workspaceId: string,
  noteId: string,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([notesStore, mutationsStore], 'readwrite')
  const notes = transaction.objectStore(notesStore)
  const mutations = transaction.objectStore(mutationsStore)
  const key = localKey(userId, workspaceId, noteId)
  const existing = (await requestResult(notes.get(key))) as LocalNote | undefined
  const remote = existing?.remoteConflict
  if (!existing || !remote) {
    transaction.abort()
    throw new Error('The note has no remote conflict to resolve.')
  }
  const related = await readMutationsForNote(mutations, userId, workspaceId, noteId)
  for (const mutation of related) {
    if (mutation.kind === 'note.update' || mutation.kind === 'note.delete') mutations.delete(mutation.id)
  }
  notes.put({
    ...remote,
    localKey: key,
    scope: scopeKey(userId, workspaceId),
    userId,
    active: remote.deletedAt === null ? 1 : 0,
    syncState: 'synced',
    serverVersion: remote.version,
    remoteConflict: null,
    conflictKind: null,
  } satisfies LocalNote)
  await transactionDone(transaction)
}

export async function resolveNoteConflictWithLocal(userId: string, workspaceId: string, noteId: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([notesStore, mutationsStore], 'readwrite')
  const notes = transaction.objectStore(notesStore)
  const mutations = transaction.objectStore(mutationsStore)
  const key = localKey(userId, workspaceId, noteId)
  const existing = (await requestResult(notes.get(key))) as LocalNote | undefined
  const remote = existing?.remoteConflict
  if (!existing || !remote || existing.conflictKind !== 'note.update') {
    transaction.abort()
    throw new Error('The note edit conflict cannot be kept locally.')
  }
  const related = await readMutationsForNote(mutations, userId, workspaceId, noteId)
  const updates = related
    .filter((mutation): mutation is NoteUpdateMutation => mutation.kind === 'note.update')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  if (updates.length === 0) {
    transaction.abort()
    throw new Error('The local note changes are no longer available.')
  }
  const changes = updates.reduce<Pick<UpdateNoteMutation, 'ticketId' | 'title' | 'content'>>(
    (merged, mutation) => ({
      ...merged,
      ...(mutation.payload.ticketId === undefined ? {} : { ticketId: mutation.payload.ticketId }),
      ...(mutation.payload.title === undefined ? {} : { title: mutation.payload.title }),
      ...(mutation.payload.content === undefined ? {} : { content: mutation.payload.content }),
    }),
    {},
  )
  const payload: UpdateNoteMutation = {
    ...changes,
    expectedVersion: remote.version,
    clientMutationId: crypto.randomUUID(),
  }
  for (const mutation of updates) mutations.delete(mutation.id)
  mutations.add({
    id: payload.clientMutationId,
    userId,
    workspaceId,
    noteId,
    kind: 'note.update',
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    state: 'pending',
  } satisfies NoteMutation)
  const ticket = changes.ticketId === undefined ? remote.ticket : existing.ticket
  notes.put({
    ...remote,
    ...changes,
    ticket,
    localKey: key,
    scope: scopeKey(userId, workspaceId),
    userId,
    version: remote.version + 1,
    updatedAt: new Date().toISOString(),
    active: 1,
    syncState: 'pending',
    serverVersion: remote.version,
    remoteConflict: null,
    conflictKind: null,
  } satisfies LocalNote)
  await transactionDone(transaction)
}

export async function resolveNoteConflictDeleteLatest(
  userId: string,
  workspaceId: string,
  noteId: string,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([notesStore, mutationsStore], 'readwrite')
  const notes = transaction.objectStore(notesStore)
  const mutations = transaction.objectStore(mutationsStore)
  const key = localKey(userId, workspaceId, noteId)
  const existing = (await requestResult(notes.get(key))) as LocalNote | undefined
  const remote = existing?.remoteConflict
  if (!existing || !remote || existing.conflictKind !== 'note.delete') {
    transaction.abort()
    throw new Error('The note deletion conflict cannot be resolved.')
  }
  const related = await readMutationsForNote(mutations, userId, workspaceId, noteId)
  for (const mutation of related) if (mutation.kind === 'note.delete') mutations.delete(mutation.id)
  const now = new Date().toISOString()
  const payload: DeleteNoteMutation = { expectedVersion: remote.version, clientMutationId: crypto.randomUUID() }
  mutations.add({
    id: payload.clientMutationId,
    userId,
    workspaceId,
    noteId,
    kind: 'note.delete',
    payload,
    createdAt: now,
    attempts: 0,
    lastError: null,
    state: 'pending',
  } satisfies NoteMutation)
  notes.put({
    ...remote,
    localKey: key,
    scope: scopeKey(userId, workspaceId),
    userId,
    version: remote.version + 1,
    updatedAt: now,
    deletedAt: now,
    deletedByUserId: null,
    active: 0,
    syncState: 'pending',
    serverVersion: remote.version,
    remoteConflict: null,
    conflictKind: null,
  } satisfies LocalNote)
  await transactionDone(transaction)
}

export async function retryFailedNoteMutations(userId: string, workspaceId: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([mutationsStore, notesStore], 'readwrite')
  const mutations = transaction.objectStore(mutationsStore)
  const range = IDBKeyRange.bound(
    [userId, workspaceId, 'failed', '', ''],
    [userId, workspaceId, 'failed', '\uffff', '\uffff'],
  )
  const failed = (await requestResult(mutations.index('user-workspace-state-created').getAll(range))) as NoteMutation[]
  for (const mutation of failed) {
    if (mutation.lastError === 'version-conflict' || mutation.lastError === 'remote-note-unavailable') continue
    mutations.put({ ...mutation, state: 'pending', lastError: null } satisfies NoteMutation)
  }
  await transactionDone(transaction)
}

export async function mergeNoteSyncPage(userId: string, workspaceId: string, notesFromServer: Note[]): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([notesStore, mutationsStore], 'readwrite')
  const notes = transaction.objectStore(notesStore)
  const mutations = transaction.objectStore(mutationsStore)
  for (const remote of notesFromServer) {
    const key = localKey(userId, workspaceId, remote.id)
    const existing = (await requestResult(notes.get(key))) as LocalNote | undefined
    const related = await readMutationsForNote(mutations, userId, workspaceId, remote.id)
    if (existing && related.length > 0) continue
    notes.put({
      ...remote,
      localKey: key,
      scope: scopeKey(userId, workspaceId),
      userId,
      active: remote.deletedAt === null ? 1 : 0,
      syncState: existing?.syncState === 'failed' ? 'failed' : 'synced',
      serverVersion: remote.version,
    } satisfies LocalNote)
  }
  await transactionDone(transaction)
}

export async function markNoteReplicaHydrated(userId: string, workspaceId: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(metadataStore, 'readwrite')
  const scope = scopeKey(userId, workspaceId)
  transaction.objectStore(metadataStore).put({ scope, hydratedAt: new Date().toISOString() } satisfies ReplicaMetadata)
  await transactionDone(transaction)
}

export async function getLocalNote(userId: string, workspaceId: string, noteId: string): Promise<Note | null> {
  const database = await openDatabase()
  const transaction = database.transaction(notesStore, 'readonly')
  const row = (await requestResult(transaction.objectStore(notesStore).get(localKey(userId, workspaceId, noteId)))) as
    LocalNote | undefined
  await transactionDone(transaction)
  return row ? noteSchema.parse(row) : null
}

export async function getLocalNoteSyncMetadata(
  userId: string,
  workspaceId: string,
  noteId: string,
): Promise<{ note: Note; syncState: SyncState; serverVersion: number } | null> {
  const database = await openDatabase()
  const transaction = database.transaction(notesStore, 'readonly')
  const row = (await requestResult(transaction.objectStore(notesStore).get(localKey(userId, workspaceId, noteId)))) as
    LocalNote | undefined
  await transactionDone(transaction)
  return row ? { note: noteSchema.parse(row), syncState: row.syncState, serverVersion: row.serverVersion } : null
}
