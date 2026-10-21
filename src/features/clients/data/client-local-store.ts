import {
  type Client,
  type CreateClientMutation,
  type DeleteClientMutation,
  type UpdateClientMutation,
  normalizeClientCode,
  clientCursorSchema,
  clientPageSize,
  clientSearchSchema,
} from '../../../../packages/clients/src/contract'
import type { ClientCursor } from '../../../../packages/clients/src/contract'

const databaseName = 'vesta-clients'
const databaseVersion = 2

const stores = {
  clients: 'clients',
  mutations: 'mutations',
} as const

type LocalClient = Client & { localKey: string; scope: string; userId: string }

type MutationBase = {
  id: string
  userId: string
  workspaceId: string
  clientId: string
  createdAt: string
  attempts: number
  lastError: string | null
  state: 'pending' | 'failed'
}

export type ClientMutation = MutationBase &
  (
    | { kind: 'client.create'; payload: CreateClientMutation }
    | { kind: 'client.update'; payload: UpdateClientMutation }
    | { kind: 'client.delete'; payload: DeleteClientMutation }
  )

export type ClientStateSnapshot = {
  clients: Client[]
  pendingCount: number
  hasFailedMutations: boolean
  hasLocalData: boolean
}

type ClientChanges = { code?: string; name?: string; active?: boolean }

let databasePromise: Promise<IDBDatabase> | null = null

function clientScope(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`
}

function clientKey(userId: string, workspaceId: string, clientId: string): string {
  return `${clientScope(userId, workspaceId)}:${clientId}`
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed.')), {
      once: true,
    })
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')),
      {
        once: true,
      },
    )
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')),
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
        if (!database.objectStoreNames.contains(stores.clients)) {
          const clientStore = database.createObjectStore(stores.clients, { keyPath: 'localKey' })
          clientStore.createIndex('scope', 'scope', { unique: false })
          clientStore.createIndex('scope-created', ['scope', 'createdAt', 'id'], { unique: false })
        } else {
          const clientStore = request.transaction?.objectStore(stores.clients)
          if (clientStore && !clientStore.indexNames.contains('scope-created')) {
            clientStore.createIndex('scope-created', ['scope', 'createdAt', 'id'], { unique: false })
          }
        }
        if (!database.objectStoreNames.contains(stores.mutations)) {
          const mutationStore = database.createObjectStore(stores.mutations, { keyPath: 'id' })
          mutationStore.createIndex('scope', ['userId', 'workspaceId'], { unique: false })
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
        reject(request.error ?? new Error('Could not open the local client database.'))
      },
      { once: true },
    )
  })
  return databasePromise
}

function fromLocalClient(row: LocalClient): Client {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    code: row.code,
    name: row.name,
    active: row.active,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    deletedByUserId: row.deletedByUserId,
  }
}

function toLocalClient(userId: string, client: Client): LocalClient {
  return {
    ...client,
    localKey: clientKey(userId, client.workspaceId, client.id),
    scope: clientScope(userId, client.workspaceId),
    userId,
  }
}

function sortMutations(left: ClientMutation, right: ClientMutation): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}

function nextMutationTimestamp(mutations: ClientMutation[]): string {
  const latest = mutations.reduce((max, mutation) => {
    const value = Date.parse(mutation.createdAt)
    return Number.isFinite(value) ? Math.max(max, value) : max
  }, 0)
  return new Date(Math.max(Date.now(), latest + 1)).toISOString()
}

function applyChanges(client: Client, changes: ClientChanges): Client {
  return {
    ...client,
    ...(changes.code === undefined ? {} : { code: changes.code }),
    ...(changes.name === undefined ? {} : { name: changes.name }),
    ...(changes.active === undefined ? {} : { active: changes.active }),
  }
}

async function clientsForScope(store: IDBObjectStore, userId: string, workspaceId: string): Promise<LocalClient[]> {
  return requestResult(store.index('scope').getAll(IDBKeyRange.only(clientScope(userId, workspaceId)))) as Promise<
    LocalClient[]
  >
}

async function mutationsForScope(
  store: IDBObjectStore,
  userId: string,
  workspaceId: string,
): Promise<ClientMutation[]> {
  return requestResult(store.index('scope').getAll(IDBKeyRange.only([userId, workspaceId]))) as Promise<
    ClientMutation[]
  >
}

export async function loadLocalClientState(userId: string, workspaceId: string): Promise<ClientStateSnapshot> {
  const page = await loadLocalClientPage(userId, workspaceId, null, '')
  return {
    clients: page.clients,
    pendingCount: page.pendingCount,
    hasFailedMutations: page.hasFailedMutations,
    hasLocalData: page.hasLocalData,
  }
}

function readClientPageRows(
  index: IDBIndex,
  scope: string,
  cursor: ClientCursor | null,
  search: string,
): Promise<LocalClient[]> {
  const lowerBound: IDBValidKey = cursor ? [scope, cursor.createdAt, cursor.id] : [scope, '', '']
  const range = IDBKeyRange.bound(lowerBound, [scope, '\uffff', '\uffff'], cursor !== null, false)
  const normalizedSearch = search.toLowerCase()

  return new Promise((resolve, reject) => {
    const rows: LocalClient[] = []
    const request = index.openCursor(range, 'next')
    request.addEventListener('success', () => {
      const current = request.result
      if (!current) {
        resolve(rows)
        return
      }

      const row = current.value as LocalClient
      const matches =
        row.deletedAt === null &&
        (!normalizedSearch ||
          row.code.toLowerCase().includes(normalizedSearch) ||
          row.name.toLowerCase().includes(normalizedSearch))
      if (matches) rows.push(row)
      if (matches && rows.length > clientPageSize) {
        resolve(rows)
        return
      }
      current.continue()
    })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Could not read the local client page.')),
      { once: true },
    )
  })
}

export async function loadLocalClientPage(
  userId: string,
  workspaceId: string,
  cursor: ClientCursor | null,
  search: string,
): Promise<ClientStateSnapshot & { nextCursor: ClientCursor | null }> {
  if (cursor) cursor = clientCursorSchema.parse(cursor)
  search = clientSearchSchema.parse(search)
  const database = await openDatabase()
  const transaction = database.transaction([stores.clients, stores.mutations], 'readonly')
  const clientIndex = transaction.objectStore(stores.clients).index('scope-created')
  const rowsPromise = readClientPageRows(clientIndex, clientScope(userId, workspaceId), cursor, search)
  const mutationsPromise = mutationsForScope(transaction.objectStore(stores.mutations), userId, workspaceId)
  const completed = transactionDone(transaction)
  let result: [LocalClient[], ClientMutation[]]
  try {
    result = await Promise.all([rowsPromise, mutationsPromise])
    await completed
  } catch (error) {
    await completed.catch(() => undefined)
    throw error
  }
  const [rows, mutations] = result

  const pageRows = rows.slice(0, clientPageSize)
  const lastClient = pageRows.at(-1)
  return {
    clients: pageRows.map(fromLocalClient),
    nextCursor:
      rows.length > clientPageSize && lastClient ? { createdAt: lastClient.createdAt, id: lastClient.id } : null,
    pendingCount: mutations.filter((mutation) => mutation.state === 'pending').length,
    hasFailedMutations: mutations.some((mutation) => mutation.state === 'failed'),
    hasLocalData: pageRows.length > 0,
  }
}

export async function enqueueClientCreation(
  userId: string,
  workspaceId: string,
  input: { code: string; name: string; active: boolean },
): Promise<Client> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.clients, stores.mutations], 'readwrite')
  const clientStore = transaction.objectStore(stores.clients)
  const mutationStore = transaction.objectStore(stores.mutations)
  const rows = await clientsForScope(clientStore, userId, workspaceId)
  if (
    rows.some(
      (client) => client.deletedAt === null && normalizeClientCode(client.code) === normalizeClientCode(input.code),
    )
  ) {
    transaction.abort()
    throw new ClientCodeConflictError()
  }
  const now = new Date().toISOString()
  const clientId = crypto.randomUUID()
  const mutationId = crypto.randomUUID()
  const createdClient: Client = {
    id: clientId,
    workspaceId,
    code: input.code,
    name: input.name,
    active: input.active,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdByUserId: userId,
    updatedByUserId: userId,
    deletedByUserId: null,
  }
  clientStore.put(toLocalClient(userId, createdClient))
  mutationStore.put({
    id: mutationId,
    userId,
    workspaceId,
    clientId,
    kind: 'client.create',
    payload: { ...input, id: clientId, clientMutationId: mutationId },
    createdAt: now,
    attempts: 0,
    lastError: null,
    state: 'pending',
  } satisfies ClientMutation)
  await transactionDone(transaction)
  return createdClient
}

export async function enqueueClientUpdate(
  userId: string,
  workspaceId: string,
  clientId: string,
  changes: ClientChanges,
): Promise<Client> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.clients, stores.mutations], 'readwrite')
  const clientStore = transaction.objectStore(stores.clients)
  const mutationStore = transaction.objectStore(stores.mutations)
  const key = clientKey(userId, workspaceId, clientId)
  const current = (await requestResult(clientStore.get(key))) as LocalClient | undefined
  if (!current || current.deletedAt !== null) {
    transaction.abort()
    throw new Error('Cannot update a client that is not available locally.')
  }
  const rows = await clientsForScope(clientStore, userId, workspaceId)
  if (
    changes.code !== undefined &&
    rows.some(
      (client) =>
        client.id !== clientId &&
        client.deletedAt === null &&
        normalizeClientCode(client.code) === normalizeClientCode(changes.code ?? ''),
    )
  ) {
    transaction.abort()
    throw new ClientCodeConflictError()
  }
  const mutations = await mutationsForScope(mutationStore, userId, workspaceId)
  const now = nextMutationTimestamp(mutations)
  const updatedClient: Client = {
    ...applyChanges(fromLocalClient(current), changes),
    version: current.version + 1,
    updatedAt: now,
    updatedByUserId: userId,
  }

  const uncreatedMutation = mutations.find(
    (mutation) =>
      mutation.clientId === clientId &&
      mutation.kind === 'client.create' &&
      (mutation.state === 'pending' || mutation.state === 'failed'),
  )
  if (uncreatedMutation?.kind === 'client.create') {
    const mutationId = crypto.randomUUID()
    const payload: CreateClientMutation = {
      id: clientId,
      clientMutationId: mutationId,
      code: updatedClient.code,
      name: updatedClient.name,
      active: updatedClient.active,
    }
    for (const queued of mutations) {
      if (queued.clientId === clientId) mutationStore.delete(queued.id)
    }
    mutationStore.put({
      ...uncreatedMutation,
      id: mutationId,
      payload,
      createdAt: now,
      attempts: 0,
      lastError: null,
      state: 'pending',
    } satisfies ClientMutation)
    const correctedClient = { ...updatedClient, version: 1 }
    clientStore.put(toLocalClient(userId, correctedClient))
    await transactionDone(transaction)
    return correctedClient
  }

  const failedUpdates = mutations
    .filter(
      (mutation): mutation is Extract<ClientMutation, { kind: 'client.update' }> =>
        mutation.clientId === clientId && mutation.kind === 'client.update' && mutation.state === 'failed',
    )
    .sort(sortMutations)
  const recoveredChanges = failedUpdates.reduce<ClientChanges>(
    (merged, mutation) => ({
      ...merged,
      ...(mutation.payload.code === undefined ? {} : { code: mutation.payload.code }),
      ...(mutation.payload.name === undefined ? {} : { name: mutation.payload.name }),
      ...(mutation.payload.active === undefined ? {} : { active: mutation.payload.active }),
    }),
    {},
  )
  const mutationId = crypto.randomUUID()
  const payload: UpdateClientMutation = {
    ...recoveredChanges,
    ...changes,
    expectedVersion: failedUpdates[0]?.payload.expectedVersion ?? current.version,
    clientMutationId: mutationId,
  }
  clientStore.put(toLocalClient(userId, updatedClient))
  for (const failed of failedUpdates) mutationStore.delete(failed.id)
  mutationStore.put({
    id: mutationId,
    userId,
    workspaceId,
    clientId,
    kind: 'client.update',
    payload,
    createdAt: now,
    attempts: 0,
    lastError: null,
    state: 'pending',
  } satisfies ClientMutation)
  await transactionDone(transaction)
  return updatedClient
}

export async function enqueueClientDeletion(userId: string, workspaceId: string, clientId: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.clients, stores.mutations], 'readwrite')
  const clientStore = transaction.objectStore(stores.clients)
  const mutationStore = transaction.objectStore(stores.mutations)
  const key = clientKey(userId, workspaceId, clientId)
  const current = (await requestResult(clientStore.get(key))) as LocalClient | undefined
  if (!current || current.deletedAt !== null) {
    transaction.abort()
    throw new Error('Cannot delete a client that is not available locally.')
  }
  const mutationId = crypto.randomUUID()
  const mutations = await mutationsForScope(mutationStore, userId, workspaceId)
  const deletedAt = nextMutationTimestamp(mutations)
  const hasUncreatedMutation = mutations.some(
    (mutation) =>
      mutation.clientId === clientId &&
      mutation.kind === 'client.create' &&
      (mutation.state === 'pending' || mutation.state === 'failed'),
  )
  if (hasUncreatedMutation) {
    for (const queued of mutations) {
      if (queued.clientId === clientId) mutationStore.delete(queued.id)
    }
    clientStore.put(
      toLocalClient(userId, {
        ...fromLocalClient(current),
        deletedAt,
        deletedByUserId: userId,
        updatedByUserId: userId,
        updatedAt: deletedAt,
        version: current.version + 1,
      }),
    )
    await transactionDone(transaction)
    return
  }
  for (const queued of mutations) {
    if (queued.clientId === clientId && queued.kind === 'client.update' && queued.state === 'failed') {
      mutationStore.delete(queued.id)
    }
  }
  const payload: DeleteClientMutation = { expectedVersion: current.version, clientMutationId: mutationId }
  clientStore.put(
    toLocalClient(userId, {
      ...fromLocalClient(current),
      deletedAt,
      deletedByUserId: userId,
      updatedByUserId: userId,
      updatedAt: deletedAt,
      version: current.version + 1,
    }),
  )
  mutationStore.put({
    id: mutationId,
    userId,
    workspaceId,
    clientId,
    kind: 'client.delete',
    payload,
    createdAt: deletedAt,
    attempts: 0,
    lastError: null,
    state: 'pending',
  } satisfies ClientMutation)
  await transactionDone(transaction)
}

export async function mergeClientSyncPage(
  userId: string,
  workspaceId: string,
  page: { clients: Client[] },
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.clients, stores.mutations], 'readwrite')
  const clientStore = transaction.objectStore(stores.clients)
  const mutationRows = await mutationsForScope(transaction.objectStore(stores.mutations), userId, workspaceId)
  const unresolvedClientIds = new Set(mutationRows.map((mutation) => mutation.clientId))
  for (const remoteClient of page.clients) {
    const key = clientKey(userId, workspaceId, remoteClient.id)
    const localClient = (await requestResult(clientStore.get(key))) as LocalClient | undefined
    if (unresolvedClientIds.has(remoteClient.id)) continue
    if (!localClient || remoteClient.version >= localClient.version) {
      clientStore.put(toLocalClient(userId, remoteClient))
    }
  }
  await transactionDone(transaction)
}

export async function listPendingClientMutations(userId: string, workspaceId: string): Promise<ClientMutation[]> {
  const database = await openDatabase()
  const transaction = database.transaction(stores.mutations, 'readonly')
  const mutations = await mutationsForScope(transaction.objectStore(stores.mutations), userId, workspaceId)
  await transactionDone(transaction)
  return mutations.filter((mutation) => mutation.state === 'pending').sort(sortMutations)
}

export async function completeClientMutation(mutation: ClientMutation, remoteClient: Client): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.clients, stores.mutations], 'readwrite')
  const clientStore = transaction.objectStore(stores.clients)
  const mutationStore = transaction.objectStore(stores.mutations)
  const key = clientKey(mutation.userId, mutation.workspaceId, remoteClient.id)
  const current = (await requestResult(clientStore.get(key))) as LocalClient | undefined
  const remaining = (await mutationsForScope(mutationStore, mutation.userId, mutation.workspaceId))
    .filter((queued) => queued.id !== mutation.id && queued.clientId === remoteClient.id)
    .sort(sortMutations)
  let merged: Client = remoteClient
  for (const queued of remaining) {
    if (queued.kind === 'client.create') {
      merged = applyChanges(merged, queued.payload)
      mutationStore.put({
        ...queued,
        kind: 'client.update',
        payload: {
          code: queued.payload.code,
          name: queued.payload.name,
          active: queued.payload.active,
          expectedVersion: remoteClient.version,
          clientMutationId: queued.id,
        },
      } satisfies ClientMutation)
    }
    if (queued.kind === 'client.update') merged = applyChanges(merged, queued.payload)
    if (queued.kind === 'client.delete') {
      merged = {
        ...merged,
        deletedAt: current?.deletedAt ?? queued.createdAt,
        deletedByUserId: current?.deletedByUserId ?? mutation.userId,
      }
    }
  }
  if (current && remaining.length > 0) {
    merged = {
      ...merged,
      version: Math.max(current.version, merged.version),
      createdAt: current.createdAt,
    }
  }
  if (
    mutation.kind === 'client.create' &&
    current != null &&
    current.deletedAt !== null &&
    !remaining.some((queued) => queued.kind === 'client.delete')
  ) {
    const now = nextMutationTimestamp(remaining)
    const deletionId = crypto.randomUUID()
    mutationStore.put({
      id: deletionId,
      userId: mutation.userId,
      workspaceId: mutation.workspaceId,
      clientId: remoteClient.id,
      kind: 'client.delete',
      payload: { expectedVersion: merged.version, clientMutationId: deletionId },
      createdAt: now,
      attempts: 0,
      lastError: null,
      state: 'pending',
    } satisfies ClientMutation)
    merged = {
      ...merged,
      deletedAt: current.deletedAt,
      deletedByUserId: current.deletedByUserId ?? mutation.userId,
      updatedByUserId: current.updatedByUserId,
      updatedAt: current.updatedAt,
    }
  }
  clientStore.put(toLocalClient(mutation.userId, merged))
  mutationStore.delete(mutation.id)
  await transactionDone(transaction)
}

export async function completeClientDeletionMutation(mutation: ClientMutation, deletedAt: string): Promise<void> {
  if (mutation.kind !== 'client.delete') throw new Error('Only client deletion mutations can be completed here.')
  const database = await openDatabase()
  const transaction = database.transaction([stores.clients, stores.mutations], 'readwrite')
  const clientStore = transaction.objectStore(stores.clients)
  const key = clientKey(mutation.userId, mutation.workspaceId, mutation.clientId)
  const current = (await requestResult(clientStore.get(key))) as LocalClient | undefined
  if (current) {
    clientStore.put(
      toLocalClient(mutation.userId, {
        ...fromLocalClient(current),
        deletedAt,
        deletedByUserId: mutation.userId,
        updatedByUserId: mutation.userId,
        updatedAt: deletedAt,
      }),
    )
  }
  transaction.objectStore(stores.mutations).delete(mutation.id)
  await transactionDone(transaction)
}

export async function recordClientMutationFailure(
  mutation: ClientMutation,
  message: string,
  permanent: boolean,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(stores.mutations, 'readwrite')
  const store = transaction.objectStore(stores.mutations)
  const current = (await requestResult(store.get(mutation.id))) as ClientMutation | undefined
  if (!current) {
    await transactionDone(transaction)
    return
  }
  store.put({
    ...current,
    attempts: current.attempts + 1,
    lastError: message,
    state: permanent ? 'failed' : 'pending',
  } satisfies ClientMutation)
  await transactionDone(transaction)
}

export async function resetClientLocalDatabaseForTests(): Promise<void> {
  if (databasePromise) (await databasePromise).close()
  databasePromise = null
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.addEventListener('success', () => resolve(), { once: true })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Could not reset the local client database.')),
      {
        once: true,
      },
    )
  })
}

export class ClientCodeConflictError extends Error {}
