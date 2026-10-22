import {
  ticketCursorSchema,
  ticketListFiltersSchema,
  ticketPageSize,
  ticketSchema,
  type CreateTicketMutation,
  type DeleteTicketMutation,
  type Ticket,
  type TicketCursor,
  type TicketListFilters,
  type UpdateTicketMutation,
} from '../../../../packages/tickets/src/contract'
import { z } from 'zod'

const databaseName = 'vesta-tickets'
const databaseVersion = 3

const stores = {
  tickets: 'tickets',
  mutations: 'mutations',
  metadata: 'metadata',
} as const

type LocalTicket = Ticket & { localKey: string; scope: string; userId: string }

type MutationBase = {
  id: string
  userId: string
  workspaceId: string
  ticketId: string
  createdAt: string
  attempts: number
  lastError: string | null
  state: 'pending' | 'failed'
}

export type TicketMutation = MutationBase &
  (
    | { kind: 'ticket.create'; payload: CreateTicketMutation }
    | { kind: 'ticket.update'; payload: UpdateTicketMutation }
    | { kind: 'ticket.delete'; payload: DeleteTicketMutation }
  )

export type TicketStateSnapshot = {
  tickets: Ticket[]
  pendingCount: number
  hasFailedMutations: boolean
  hasLocalData: boolean
  hasCompleteReplica: boolean
  hasOtNumberConflict: boolean
}

const ticketReplicaMetadataSchema = z.object({ scope: z.string(), hydratedAt: z.string().datetime() })
type TicketReplicaMetadata = z.infer<typeof ticketReplicaMetadataSchema>

type TicketChanges = Partial<
  Pick<
    Ticket,
    'otNumber' | 'clientId' | 'title' | 'description' | 'priority' | 'status' | 'estimatedHours' | 'workedHours'
  >
>

let databasePromise: Promise<IDBDatabase> | null = null

function ticketScope(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`
}

function ticketKey(userId: string, workspaceId: string, ticketId: string): string {
  return `${ticketScope(userId, workspaceId)}:${ticketId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function readReplicaMetadata(store: IDBObjectStore, scope: string): Promise<TicketReplicaMetadata | undefined> {
  return new Promise((resolve, reject) => {
    const request = store.get(scope)
    request.addEventListener(
      'success',
      () => {
        if (request.result === undefined) {
          resolve(undefined)
          return
        }
        const parsed = ticketReplicaMetadataSchema.safeParse(request.result)
        if (!parsed.success) {
          reject(new Error('Could not validate the local ticket replica state.'))
          return
        }
        resolve(parsed.data)
      },
      { once: true },
    )
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Could not read the local ticket replica state.')),
      { once: true },
    )
  })
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)
    request.addEventListener(
      'upgradeneeded',
      (event) => {
        const database = request.result
        const upgrade = request.transaction
        if (!upgrade) throw new Error('Ticket database migration has no transaction.')
        const oldVersion = event.oldVersion
        const ticketStore = database.objectStoreNames.contains(stores.tickets)
          ? upgrade.objectStore(stores.tickets)
          : database.createObjectStore(stores.tickets, { keyPath: 'localKey' })
        if (!ticketStore.indexNames.contains('scope')) ticketStore.createIndex('scope', 'scope', { unique: false })
        if (!ticketStore.indexNames.contains('scope-created')) {
          ticketStore.createIndex('scope-created', ['scope', 'createdAt', 'id'], { unique: false })
        }
        if (!ticketStore.indexNames.contains('scope-ot-number')) {
          ticketStore.createIndex('scope-ot-number', ['scope', 'otNumber'], { unique: false })
        }
        const mutationStore = database.objectStoreNames.contains(stores.mutations)
          ? upgrade.objectStore(stores.mutations)
          : database.createObjectStore(stores.mutations, { keyPath: 'id' })
        if (!mutationStore.indexNames.contains('scope')) {
          mutationStore.createIndex('scope', ['userId', 'workspaceId'], { unique: false })
        }
        if (oldVersion < 3) {
          const ticketRowsRequest = ticketStore.getAll()
          ticketRowsRequest.addEventListener('success', () => {
            const rows = (ticketRowsRequest.result as LocalTicket[]).sort(
              (left, right) =>
                left.scope.localeCompare(right.scope) ||
                left.createdAt.localeCompare(right.createdAt) ||
                left.id.localeCompare(right.id),
            )
            const nextByScope = new Map<string, number>()
            const numberByTicket = new Map<string, number>()
            for (const row of rows) {
              const next = (nextByScope.get(row.scope) ?? 0) + 1
              const otNumber = row.otNumber ?? next
              nextByScope.set(row.scope, Math.max(nextByScope.get(row.scope) ?? 0, otNumber))
              numberByTicket.set(`${row.scope}:${row.id}`, otNumber)
              ticketStore.put({ ...row, otNumber })
            }
            const mutationsRequest = mutationStore.getAll()
            mutationsRequest.addEventListener('success', () => {
              for (const candidate of mutationsRequest.result as unknown[]) {
                if (
                  !isRecord(candidate) ||
                  candidate.kind !== 'ticket.create' ||
                  !isRecord(candidate.payload) ||
                  'otNumber' in candidate.payload ||
                  typeof candidate.userId !== 'string' ||
                  typeof candidate.workspaceId !== 'string' ||
                  typeof candidate.ticketId !== 'string'
                )
                  continue
                const scope = ticketScope(candidate.userId, candidate.workspaceId)
                const otNumber = numberByTicket.get(`${scope}:${candidate.ticketId}`)
                if (otNumber !== undefined) {
                  mutationStore.put({
                    ...candidate,
                    payload: { ...candidate.payload, otNumber },
                  })
                }
              }
            })
          })
        }
        if (!database.objectStoreNames.contains(stores.metadata)) {
          database.createObjectStore(stores.metadata, { keyPath: 'scope' })
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
        reject(request.error ?? new Error('Could not open the local ticket database.'))
      },
      { once: true },
    )
  })
  return databasePromise
}

function toLocalTicket(userId: string, ticket: Ticket): LocalTicket {
  return {
    ...ticket,
    userId,
    scope: ticketScope(userId, ticket.workspaceId),
    localKey: ticketKey(userId, ticket.workspaceId, ticket.id),
  }
}

function fromLocalTicket(ticket: LocalTicket): Ticket {
  return {
    id: ticket.id,
    workspaceId: ticket.workspaceId,
    otNumber: ticket.otNumber,
    clientId: ticket.clientId,
    clientName: ticket.clientName,
    title: ticket.title,
    description: ticket.description,
    priority: ticket.priority,
    status: ticket.status,
    estimatedHours: ticket.estimatedHours,
    workedHours: ticket.workedHours,
    codingFinishedAt: ticket.codingFinishedAt,
    productionAt: ticket.productionAt,
    version: ticket.version,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    deletedAt: ticket.deletedAt,
    createdByUserId: ticket.createdByUserId,
    updatedByUserId: ticket.updatedByUserId,
    deletedByUserId: ticket.deletedByUserId,
  }
}

async function mutationsForScope(
  store: IDBObjectStore,
  userId: string,
  workspaceId: string,
): Promise<TicketMutation[]> {
  return requestResult(store.index('scope').getAll(IDBKeyRange.only([userId, workspaceId]))) as Promise<
    TicketMutation[]
  >
}

function sortMutations(left: TicketMutation, right: TicketMutation): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}

function readTicketPageRows(
  index: IDBIndex,
  scope: string,
  cursor: TicketCursor | null,
  filters: TicketListFilters,
): Promise<LocalTicket[]> {
  const upperBound: IDBValidKey = cursor ? [scope, cursor.createdAt, cursor.id] : [scope, '\uffff', '\uffff']
  const range = IDBKeyRange.bound([scope, '', ''], upperBound, false, cursor !== null)
  const normalizedSearch = filters.search.toLowerCase()

  return new Promise((resolve, reject) => {
    const rows: LocalTicket[] = []
    const request = index.openCursor(range, 'prev')
    request.addEventListener('success', () => {
      const current = request.result
      if (!current) {
        resolve(rows)
        return
      }
      const row = current.value as LocalTicket
      const matches =
        row.deletedAt === null &&
        (filters.status === null || row.status === filters.status) &&
        (filters.priority === null || row.priority === filters.priority) &&
        (!normalizedSearch ||
          row.title.toLowerCase().includes(normalizedSearch) ||
          row.description.toLowerCase().includes(normalizedSearch))
      if (matches) rows.push(row)
      if (matches && rows.length > ticketPageSize) {
        resolve(rows)
        return
      }
      current.continue()
    })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Could not read the local ticket page.')),
      { once: true },
    )
  })
}

function applyChanges(ticket: Ticket, changes: TicketChanges): Ticket {
  return { ...ticket, ...changes }
}

function updateChangesFromPayload(payload: UpdateTicketMutation): TicketChanges {
  const changes: TicketChanges = {}
  if (payload.otNumber !== undefined) changes.otNumber = payload.otNumber
  if (payload.clientId !== undefined) changes.clientId = payload.clientId
  if (payload.title !== undefined) changes.title = payload.title
  if (payload.description !== undefined) changes.description = payload.description
  if (payload.priority !== undefined) changes.priority = payload.priority
  if (payload.status !== undefined) changes.status = payload.status
  if (payload.estimatedHours !== undefined) changes.estimatedHours = payload.estimatedHours
  if (payload.workedHours !== undefined) changes.workedHours = payload.workedHours
  return changes
}

async function ensureLocalOtNumberAvailable(
  store: IDBObjectStore,
  scope: string,
  otNumber: number,
  excludedTicketId?: string,
): Promise<void> {
  const matches = (await requestResult(
    store.index('scope-ot-number').getAll(IDBKeyRange.only([scope, otNumber])),
  )) as LocalTicket[]
  if (matches.some((ticket) => ticket.id !== excludedTicketId)) {
    throw new Error('ot-number-conflict')
  }
}

export async function getNextLocalTicketOtNumber(userId: string, workspaceId: string): Promise<number> {
  const database = await openDatabase()
  const transaction = database.transaction(stores.tickets, 'readonly')
  const completed = transactionDone(transaction)
  const scope = ticketScope(userId, workspaceId)
  const range = IDBKeyRange.bound([scope, 1], [scope, 2_147_483_647])
  const request = transaction.objectStore(stores.tickets).index('scope-ot-number').openCursor(range, 'prev')
  const highest = await new Promise<number>((resolve, reject) => {
    request.addEventListener(
      'success',
      () => {
        const cursor = request.result
        resolve(cursor ? (cursor.value as LocalTicket).otNumber : 0)
      },
      { once: true },
    )
    request.addEventListener('error', () => reject(request.error ?? new Error('Could not suggest an OT number.')), {
      once: true,
    })
  })
  await completed
  if (highest >= 2_147_483_647) throw new Error('The OT number limit has been reached.')
  return highest + 1
}

export async function loadLocalTicketPage(
  userId: string,
  workspaceId: string,
  cursor: TicketCursor | null,
  rawFilters: TicketListFilters,
): Promise<TicketStateSnapshot & { nextCursor: TicketCursor | null }> {
  if (cursor) cursor = ticketCursorSchema.parse(cursor)
  const filters = ticketListFiltersSchema.parse(rawFilters)
  const database = await openDatabase()
  const transaction = database.transaction([stores.tickets, stores.mutations, stores.metadata], 'readonly')
  const ticketIndex = transaction.objectStore(stores.tickets).index('scope-created')
  const rowsPromise = readTicketPageRows(ticketIndex, ticketScope(userId, workspaceId), cursor, filters)
  const mutationsPromise = mutationsForScope(transaction.objectStore(stores.mutations), userId, workspaceId)
  const metadataPromise = readReplicaMetadata(
    transaction.objectStore(stores.metadata),
    ticketScope(userId, workspaceId),
  )
  const completed = transactionDone(transaction)
  let result: [LocalTicket[], TicketMutation[], TicketReplicaMetadata | undefined]
  try {
    result = await Promise.all([rowsPromise, mutationsPromise, metadataPromise])
    await completed
  } catch (error) {
    await completed.catch(() => undefined)
    throw error
  }
  const [rows, mutations, metadata] = result
  const pageRows = rows.slice(0, ticketPageSize)
  const lastTicket = pageRows.at(-1)
  return {
    tickets: pageRows.map(fromLocalTicket),
    nextCursor:
      rows.length > ticketPageSize && lastTicket ? { createdAt: lastTicket.createdAt, id: lastTicket.id } : null,
    pendingCount: mutations.filter((mutation) => mutation.state === 'pending').length,
    hasFailedMutations: mutations.some((mutation) => mutation.state === 'failed'),
    hasLocalData: pageRows.length > 0,
    hasCompleteReplica: Boolean(metadata?.hydratedAt),
    hasOtNumberConflict: mutations.some(
      (mutation) => mutation.state === 'failed' && mutation.lastError === 'ot-number-conflict',
    ),
  }
}

export async function markTicketReplicaHydrated(userId: string, workspaceId: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(stores.metadata, 'readwrite')
  transaction.objectStore(stores.metadata).put(
    ticketReplicaMetadataSchema.parse({
      scope: ticketScope(userId, workspaceId),
      hydratedAt: new Date().toISOString(),
    }),
  )
  await transactionDone(transaction)
}

function nextMutationTimestamp(mutations: TicketMutation[]): string {
  const latest = mutations.reduce((time, mutation) => Math.max(time, Date.parse(mutation.createdAt)), 0)
  return new Date(Math.max(Date.now(), latest + 1)).toISOString()
}

export async function enqueueTicketCreation(
  userId: string,
  workspaceId: string,
  input: Omit<CreateTicketMutation, 'id' | 'clientMutationId'>,
  clientName: string | null,
): Promise<Ticket> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.tickets, stores.mutations], 'readwrite')
  const ticketStore = transaction.objectStore(stores.tickets)
  const mutationStore = transaction.objectStore(stores.mutations)
  await ensureLocalOtNumberAvailable(ticketStore, ticketScope(userId, workspaceId), input.otNumber)
  const mutations = await mutationsForScope(mutationStore, userId, workspaceId)
  const now = nextMutationTimestamp(mutations)
  const ticketId = crypto.randomUUID()
  const mutationId = crypto.randomUUID()
  const createdTicket = ticketSchema.parse({
    ...input,
    id: ticketId,
    workspaceId,
    clientName,
    version: 1,
    codingFinishedAt: input.status === 'delivered' ? now : null,
    productionAt: input.status === 'production' ? now : null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdByUserId: userId,
    updatedByUserId: userId,
    deletedByUserId: null,
  })
  ticketStore.put(toLocalTicket(userId, createdTicket))
  mutationStore.put({
    id: mutationId,
    userId,
    workspaceId,
    ticketId,
    kind: 'ticket.create',
    payload: { ...input, id: ticketId, clientMutationId: mutationId },
    createdAt: now,
    attempts: 0,
    lastError: null,
    state: 'pending',
  } satisfies TicketMutation)
  await transactionDone(transaction)
  return createdTicket
}

export async function enqueueTicketUpdate(
  userId: string,
  workspaceId: string,
  ticketId: string,
  changes: TicketChanges,
  clientName?: string | null,
): Promise<Ticket> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.tickets, stores.mutations], 'readwrite')
  const ticketStore = transaction.objectStore(stores.tickets)
  const mutationStore = transaction.objectStore(stores.mutations)
  const key = ticketKey(userId, workspaceId, ticketId)
  const current = (await requestResult(ticketStore.get(key))) as LocalTicket | undefined
  if (!current || current.deletedAt !== null) {
    transaction.abort()
    throw new Error('Cannot update a ticket that is not available locally.')
  }
  if (changes.otNumber !== undefined) {
    await ensureLocalOtNumberAvailable(ticketStore, ticketScope(userId, workspaceId), changes.otNumber, ticketId)
  }
  const mutations = (await mutationsForScope(mutationStore, userId, workspaceId)).filter(
    (mutation) => mutation.ticketId === ticketId,
  )
  const now = nextMutationTimestamp(mutations)
  const updatedTicket = ticketSchema.parse({
    ...applyChanges(fromLocalTicket(current), changes),
    ...(changes.clientId === undefined ? {} : { clientName: clientName ?? null }),
    version: current.version + 1,
    updatedAt: now,
    updatedByUserId: userId,
    ...(changes.status === 'delivered' ? { codingFinishedAt: now } : {}),
    ...(changes.status === 'production' ? { productionAt: now } : {}),
  })

  const pendingCreation = mutations.find(
    (mutation): mutation is Extract<TicketMutation, { kind: 'ticket.create' }> =>
      mutation.kind === 'ticket.create' && (mutation.state === 'pending' || mutation.state === 'failed'),
  )
  if (pendingCreation) {
    const mutationId = crypto.randomUUID()
    const payload: CreateTicketMutation = {
      id: ticketId,
      clientMutationId: mutationId,
      otNumber: updatedTicket.otNumber,
      clientId: updatedTicket.clientId,
      title: updatedTicket.title,
      description: updatedTicket.description,
      priority: updatedTicket.priority,
      status: updatedTicket.status,
      estimatedHours: updatedTicket.estimatedHours,
      workedHours: updatedTicket.workedHours,
    }
    for (const mutation of mutations) mutationStore.delete(mutation.id)
    mutationStore.put({
      ...pendingCreation,
      id: mutationId,
      payload,
      createdAt: now,
      attempts: 0,
      lastError: null,
      state: 'pending',
    } satisfies TicketMutation)
    const coalescedTicket = { ...updatedTicket, version: 1 }
    ticketStore.put(toLocalTicket(userId, coalescedTicket))
    await transactionDone(transaction)
    return coalescedTicket
  }

  const queuedUpdates = mutations
    .filter(
      (mutation): mutation is Extract<TicketMutation, { kind: 'ticket.update' }> => mutation.kind === 'ticket.update',
    )
    .sort(sortMutations)
  if (queuedUpdates.some((mutation) => mutation.state === 'failed')) {
    const mutationId = crypto.randomUUID()
    const expectedVersion = queuedUpdates[0]?.payload.expectedVersion ?? current.version
    const queuedChanges = queuedUpdates.reduce<TicketChanges>((combined, mutation) => {
      return { ...combined, ...updateChangesFromPayload(mutation.payload) }
    }, {})
    const payload: UpdateTicketMutation = {
      ...queuedChanges,
      ...changes,
      expectedVersion,
      clientMutationId: mutationId,
    }
    for (const mutation of queuedUpdates) mutationStore.delete(mutation.id)
    mutationStore.put({
      id: mutationId,
      userId,
      workspaceId,
      ticketId,
      kind: 'ticket.update',
      payload,
      createdAt: now,
      attempts: 0,
      lastError: null,
      state: 'pending',
    } satisfies TicketMutation)
    const coalescedTicket = { ...updatedTicket, version: expectedVersion + 1 }
    ticketStore.put(toLocalTicket(userId, coalescedTicket))
    await transactionDone(transaction)
    return coalescedTicket
  }

  const mutationId = crypto.randomUUID()
  const payload: UpdateTicketMutation = { ...changes, expectedVersion: current.version, clientMutationId: mutationId }
  ticketStore.put(toLocalTicket(userId, updatedTicket))
  mutationStore.put({
    id: mutationId,
    userId,
    workspaceId,
    ticketId,
    kind: 'ticket.update',
    payload,
    createdAt: now,
    attempts: 0,
    lastError: null,
    state: 'pending',
  } satisfies TicketMutation)
  await transactionDone(transaction)
  return updatedTicket
}

export async function enqueueTicketDeletion(userId: string, workspaceId: string, ticketId: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.tickets, stores.mutations], 'readwrite')
  const ticketStore = transaction.objectStore(stores.tickets)
  const mutationStore = transaction.objectStore(stores.mutations)
  const key = ticketKey(userId, workspaceId, ticketId)
  const current = (await requestResult(ticketStore.get(key))) as LocalTicket | undefined
  if (!current || current.deletedAt !== null) {
    transaction.abort()
    throw new Error('Cannot delete a ticket that is not available locally.')
  }
  const mutations = await mutationsForScope(mutationStore, userId, workspaceId)
  const now = nextMutationTimestamp(mutations)
  const mutationId = crypto.randomUUID()
  ticketStore.put(
    toLocalTicket(userId, {
      ...fromLocalTicket(current),
      version: current.version + 1,
      deletedAt: now,
      deletedByUserId: userId,
      updatedByUserId: userId,
      updatedAt: now,
    }),
  )
  mutationStore.put({
    id: mutationId,
    userId,
    workspaceId,
    ticketId,
    kind: 'ticket.delete',
    payload: { expectedVersion: current.version, clientMutationId: mutationId },
    createdAt: now,
    attempts: 0,
    lastError: null,
    state: 'pending',
  } satisfies TicketMutation)
  await transactionDone(transaction)
}

export async function mergeTicketSyncPage(
  userId: string,
  workspaceId: string,
  page: { tickets: Ticket[] },
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.tickets, stores.mutations], 'readwrite')
  const ticketStore = transaction.objectStore(stores.tickets)
  const mutationRows = await mutationsForScope(transaction.objectStore(stores.mutations), userId, workspaceId)
  const unresolvedTicketIds = new Set(mutationRows.map((mutation) => mutation.ticketId))
  for (const remoteTicket of page.tickets) {
    const key = ticketKey(userId, workspaceId, remoteTicket.id)
    const localTicket = (await requestResult(ticketStore.get(key))) as LocalTicket | undefined
    if (unresolvedTicketIds.has(remoteTicket.id)) continue
    if (!localTicket || remoteTicket.version >= localTicket.version) {
      ticketStore.put(toLocalTicket(userId, remoteTicket))
    }
  }
  await transactionDone(transaction)
}

export async function listPendingTicketMutations(userId: string, workspaceId: string): Promise<TicketMutation[]> {
  const database = await openDatabase()
  const transaction = database.transaction(stores.mutations, 'readonly')
  const mutations = await mutationsForScope(transaction.objectStore(stores.mutations), userId, workspaceId)
  await transactionDone(transaction)
  return mutations.filter((mutation) => mutation.state === 'pending').sort(sortMutations)
}

export async function rebasePendingTicketMutations(
  userId: string,
  workspaceId: string,
  ticketId: string,
  remoteTicket: Ticket,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.tickets, stores.mutations], 'readwrite')
  const ticketStore = transaction.objectStore(stores.tickets)
  const mutationStore = transaction.objectStore(stores.mutations)
  const queued = (await mutationsForScope(mutationStore, userId, workspaceId))
    .filter((mutation) => mutation.ticketId === ticketId && mutation.state === 'pending')
    .sort(sortMutations)
  const localKey = ticketKey(userId, workspaceId, ticketId)
  const current = (await requestResult(ticketStore.get(localKey))) as LocalTicket | undefined
  let expectedVersion = remoteTicket.version
  let rebasedTicket = remoteTicket
  let updatedCount = 0
  for (const mutation of queued) {
    if (mutation.kind === 'ticket.update') {
      const patch = updateChangesFromPayload(mutation.payload)
      rebasedTicket = applyChanges(rebasedTicket, patch)
      if (patch.clientId !== undefined) {
        rebasedTicket = { ...rebasedTicket, clientName: current?.clientName ?? null }
      }
      if (patch.status === 'delivered' && current?.codingFinishedAt) {
        rebasedTicket = { ...rebasedTicket, codingFinishedAt: current.codingFinishedAt }
      }
      if (patch.status === 'production' && current?.productionAt) {
        rebasedTicket = { ...rebasedTicket, productionAt: current.productionAt }
      }
      mutationStore.put({
        ...mutation,
        payload: { ...mutation.payload, expectedVersion },
      } satisfies TicketMutation)
      expectedVersion += 1
      updatedCount += 1
    } else if (mutation.kind === 'ticket.delete') {
      mutationStore.put({
        ...mutation,
        payload: { ...mutation.payload, expectedVersion },
      } satisfies TicketMutation)
      expectedVersion += 1
    }
  }
  if (current && queued.length > 0) {
    if (queued.some((mutation) => mutation.kind === 'ticket.delete')) {
      rebasedTicket = {
        ...rebasedTicket,
        deletedAt: current.deletedAt,
        deletedByUserId: current.deletedByUserId,
      }
    }
    ticketStore.put(
      toLocalTicket(userId, {
        ...rebasedTicket,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        updatedByUserId: userId,
        version:
          remoteTicket.version + updatedCount + (queued.some((mutation) => mutation.kind === 'ticket.delete') ? 1 : 0),
      }),
    )
  }
  await transactionDone(transaction)
}

export async function completeTicketMutation(mutation: TicketMutation, remoteTicket: Ticket): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.tickets, stores.mutations], 'readwrite')
  const ticketStore = transaction.objectStore(stores.tickets)
  const mutationStore = transaction.objectStore(stores.mutations)
  const key = ticketKey(mutation.userId, mutation.workspaceId, remoteTicket.id)
  const current = (await requestResult(ticketStore.get(key))) as LocalTicket | undefined
  const remaining = (await mutationsForScope(mutationStore, mutation.userId, mutation.workspaceId))
    .filter((queued) => queued.id !== mutation.id && queued.ticketId === remoteTicket.id)
    .sort(sortMutations)
  let merged: Ticket = remoteTicket
  for (const queued of remaining) {
    if (queued.kind === 'ticket.update') {
      merged = applyChanges(merged, updateChangesFromPayload(queued.payload))
    }
    if (queued.kind === 'ticket.delete') {
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
      version: remoteTicket.version + remaining.length,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    }
  }
  ticketStore.put(toLocalTicket(mutation.userId, merged))
  mutationStore.delete(mutation.id)
  await transactionDone(transaction)
}

export async function completeTicketDeletionMutation(mutation: TicketMutation, deletedAt: string): Promise<void> {
  if (mutation.kind !== 'ticket.delete') throw new Error('Only ticket deletion mutations can be completed here.')
  const database = await openDatabase()
  const transaction = database.transaction([stores.tickets, stores.mutations], 'readwrite')
  const ticketStore = transaction.objectStore(stores.tickets)
  const key = ticketKey(mutation.userId, mutation.workspaceId, mutation.ticketId)
  const current = (await requestResult(ticketStore.get(key))) as LocalTicket | undefined
  if (current) {
    ticketStore.put(
      toLocalTicket(mutation.userId, {
        ...fromLocalTicket(current),
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

export async function recordTicketMutationFailure(
  mutation: TicketMutation,
  message: string,
  permanent: boolean,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(stores.mutations, 'readwrite')
  const store = transaction.objectStore(stores.mutations)
  const current = (await requestResult(store.get(mutation.id))) as TicketMutation | undefined
  if (!current) {
    await transactionDone(transaction)
    return
  }
  store.put({
    ...current,
    attempts: current.attempts + 1,
    lastError: message,
    state: permanent ? 'failed' : 'pending',
  } satisfies TicketMutation)
  await transactionDone(transaction)
}

export async function resetTicketLocalDatabaseForTests(): Promise<void> {
  if (databasePromise) (await databasePromise).close()
  databasePromise = null
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.addEventListener('success', () => resolve(), { once: true })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Could not reset the local ticket database.')),
      {
        once: true,
      },
    )
  })
}
