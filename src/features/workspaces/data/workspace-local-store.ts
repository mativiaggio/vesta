import type {
  ActivateWorkspaceMutation,
  CreateWorkspaceMutation,
  Workspace,
} from '../../../../packages/workspaces/src/contract'

const databaseName = 'vesta-workspaces'
const databaseVersion = 1

const stores = {
  metadata: 'metadata',
  mutations: 'mutations',
  workspaces: 'workspaces',
} as const

type WorkspaceMetadata = {
  userId: string
  activeWorkspaceId: string | null
  nextCursor: string | null
  lastServerSyncAt: string | null
}

type LocalWorkspace = Workspace & { localKey: string; userId: string }

type MutationBase = {
  id: string
  userId: string
  workspaceId: string
  createdAt: string
  attempts: number
  lastError: string | null
  state: 'pending' | 'failed'
}

export type WorkspaceMutation = MutationBase &
  (
    | { kind: 'workspace.create'; payload: CreateWorkspaceMutation }
    | { kind: 'workspace.activate'; payload: ActivateWorkspaceMutation }
  )

export type LocalWorkspaceState = {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  nextCursor: string | null
  pendingCount: number
  hasFailedMutations: boolean
  hasLocalData: boolean
}

let databasePromise: Promise<IDBDatabase> | null = null

function workspaceKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`
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
      { once: true },
    )
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')),
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
      () => {
        const database = request.result
        if (!database.objectStoreNames.contains(stores.workspaces)) {
          const workspaceStore = database.createObjectStore(stores.workspaces, { keyPath: 'localKey' })
          workspaceStore.createIndex('userId', 'userId', { unique: false })
        }
        if (!database.objectStoreNames.contains(stores.metadata)) {
          database.createObjectStore(stores.metadata, { keyPath: 'userId' })
        }
        if (!database.objectStoreNames.contains(stores.mutations)) {
          const mutationStore = database.createObjectStore(stores.mutations, { keyPath: 'id' })
          mutationStore.createIndex('userId', 'userId', { unique: false })
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
        reject(request.error ?? new Error('Could not open the local workspace database.'))
      },
      { once: true },
    )
  })

  return databasePromise
}

async function mutationsForUser(store: IDBObjectStore, userId: string): Promise<WorkspaceMutation[]> {
  return requestResult(store.index('userId').getAll(IDBKeyRange.only(userId))) as Promise<WorkspaceMutation[]>
}

function fromLocalWorkspace(row: LocalWorkspace): Workspace {
  return {
    id: row.id,
    name: row.name,
    accentColor: row.accentColor,
    icon: row.icon,
    lastAccessedAt: row.lastAccessedAt,
    version: row.version,
    membershipVersion: row.membershipVersion,
  }
}

function toLocalWorkspace(userId: string, workspace: Workspace): LocalWorkspace {
  return { ...workspace, localKey: workspaceKey(userId, workspace.id), userId }
}

export async function loadLocalWorkspaceState(userId: string): Promise<LocalWorkspaceState> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.workspaces, stores.metadata, stores.mutations], 'readonly')
  const workspaceRowsPromise = requestResult(
    transaction.objectStore(stores.workspaces).index('userId').getAll(IDBKeyRange.only(userId)),
  ) as Promise<LocalWorkspace[]>
  const metadataPromise = requestResult(transaction.objectStore(stores.metadata).get(userId)) as Promise<
    WorkspaceMetadata | undefined
  >
  const mutationsPromise = mutationsForUser(transaction.objectStore(stores.mutations), userId)
  const [workspaceRows, metadata, mutations] = await Promise.all([
    workspaceRowsPromise,
    metadataPromise,
    mutationsPromise,
  ])
  await transactionDone(transaction)

  return {
    workspaces: workspaceRows.map(fromLocalWorkspace).sort((left, right) => left.id.localeCompare(right.id)),
    activeWorkspaceId: metadata?.activeWorkspaceId ?? null,
    nextCursor: metadata?.nextCursor ?? null,
    pendingCount: mutations.filter((mutation) => mutation.state === 'pending').length,
    hasFailedMutations: mutations.some((mutation) => mutation.state === 'failed'),
    hasLocalData: workspaceRows.length > 0 || Boolean(metadata),
  }
}

export async function mergeWorkspacePage(
  userId: string,
  page: { workspaces: Workspace[]; lastWorkspaceId: string | null; nextCursor: string | null },
  isFirstPage: boolean,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.workspaces, stores.metadata, stores.mutations], 'readwrite')
  const workspaceStore = transaction.objectStore(stores.workspaces)
  const metadataStore = transaction.objectStore(stores.metadata)
  const currentMetadata = (await requestResult(metadataStore.get(userId))) as WorkspaceMetadata | undefined
  const mutations = await mutationsForUser(transaction.objectStore(stores.mutations), userId)
  const hasPendingSelection = mutations.some((mutation) => mutation.state === 'pending')

  for (const remoteWorkspace of page.workspaces) {
    const key = workspaceKey(userId, remoteWorkspace.id)
    const localWorkspace = (await requestResult(workspaceStore.get(key))) as LocalWorkspace | undefined
    const lastAccessedAt =
      localWorkspace?.lastAccessedAt && remoteWorkspace.lastAccessedAt
        ? new Date(localWorkspace.lastAccessedAt) > new Date(remoteWorkspace.lastAccessedAt)
          ? localWorkspace.lastAccessedAt
          : remoteWorkspace.lastAccessedAt
        : (localWorkspace?.lastAccessedAt ?? remoteWorkspace.lastAccessedAt)
    workspaceStore.put(toLocalWorkspace(userId, { ...remoteWorkspace, lastAccessedAt }))
  }

  metadataStore.put({
    userId,
    activeWorkspaceId:
      isFirstPage && !hasPendingSelection
        ? page.lastWorkspaceId
        : (currentMetadata?.activeWorkspaceId ?? page.lastWorkspaceId),
    nextCursor: page.nextCursor,
    lastServerSyncAt: new Date().toISOString(),
  } satisfies WorkspaceMetadata)

  await transactionDone(transaction)
}

export async function enqueueWorkspaceCreation(userId: string, input: CreateWorkspaceMutation): Promise<Workspace> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.workspaces, stores.metadata, stores.mutations], 'readwrite')
  const now = new Date().toISOString()
  const metadataStore = transaction.objectStore(stores.metadata)
  const currentMetadata = (await requestResult(metadataStore.get(userId))) as WorkspaceMetadata | undefined
  const localWorkspace: Workspace = {
    id: input.id,
    name: input.name,
    accentColor: input.accentColor,
    icon: input.icon,
    lastAccessedAt: now,
    version: 1,
    membershipVersion: 1,
  }
  transaction.objectStore(stores.workspaces).put(toLocalWorkspace(userId, localWorkspace))
  metadataStore.put({
    userId,
    activeWorkspaceId: input.id,
    nextCursor: currentMetadata?.nextCursor ?? null,
    lastServerSyncAt: currentMetadata?.lastServerSyncAt ?? null,
  } satisfies WorkspaceMetadata)
  transaction.objectStore(stores.mutations).put({
    id: input.clientMutationId,
    userId,
    workspaceId: input.id,
    kind: 'workspace.create',
    payload: input,
    createdAt: now,
    attempts: 0,
    lastError: null,
    state: 'pending',
  } satisfies WorkspaceMutation)
  await transactionDone(transaction)
  return localWorkspace
}

export async function enqueueWorkspaceActivation(
  userId: string,
  workspaceId: string,
  input: ActivateWorkspaceMutation,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.workspaces, stores.metadata, stores.mutations], 'readwrite')
  const workspaceStore = transaction.objectStore(stores.workspaces)
  const metadataStore = transaction.objectStore(stores.metadata)
  const key = workspaceKey(userId, workspaceId)
  const [current, currentMetadata] = await Promise.all([
    requestResult(workspaceStore.get(key)) as Promise<LocalWorkspace | undefined>,
    requestResult(metadataStore.get(userId)) as Promise<WorkspaceMetadata | undefined>,
  ])
  if (!current) {
    transaction.abort()
    throw new Error('Cannot activate a workspace that is not available locally.')
  }

  workspaceStore.put({ ...current, lastAccessedAt: input.accessedAt })
  metadataStore.put({
    userId,
    activeWorkspaceId: workspaceId,
    nextCursor: currentMetadata?.nextCursor ?? null,
    lastServerSyncAt: currentMetadata?.lastServerSyncAt ?? null,
  } satisfies WorkspaceMetadata)
  transaction.objectStore(stores.mutations).put({
    id: input.clientMutationId,
    userId,
    workspaceId,
    kind: 'workspace.activate',
    payload: input,
    createdAt: input.accessedAt,
    attempts: 0,
    lastError: null,
    state: 'pending',
  } satisfies WorkspaceMutation)
  await transactionDone(transaction)
}

export async function listPendingWorkspaceMutations(userId: string): Promise<WorkspaceMutation[]> {
  const database = await openDatabase()
  const transaction = database.transaction(stores.mutations, 'readonly')
  const mutations = await mutationsForUser(transaction.objectStore(stores.mutations), userId)
  await transactionDone(transaction)
  return mutations
    .filter((mutation) => mutation.state === 'pending')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export async function completeWorkspaceMutation(mutation: WorkspaceMutation, workspace: Workspace): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.workspaces, stores.mutations], 'readwrite')
  transaction.objectStore(stores.workspaces).put(toLocalWorkspace(mutation.userId, workspace))
  transaction.objectStore(stores.mutations).delete(mutation.id)
  await transactionDone(transaction)
}

export async function completeActivationMutation(
  mutation: WorkspaceMutation,
  activation: { workspaceId: string; lastAccessedAt: string; membershipVersion: number },
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([stores.workspaces, stores.mutations], 'readwrite')
  const workspaceStore = transaction.objectStore(stores.workspaces)
  const key = workspaceKey(mutation.userId, activation.workspaceId)
  const current = (await requestResult(workspaceStore.get(key))) as LocalWorkspace | undefined
  if (current) {
    workspaceStore.put({
      ...current,
      lastAccessedAt: activation.lastAccessedAt,
      membershipVersion: activation.membershipVersion,
    })
  }
  transaction.objectStore(stores.mutations).delete(mutation.id)
  await transactionDone(transaction)
}

export async function recordWorkspaceMutationFailure(
  mutation: WorkspaceMutation,
  message: string,
  permanent: boolean,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(stores.mutations, 'readwrite')
  transaction.objectStore(stores.mutations).put({
    ...mutation,
    attempts: mutation.attempts + 1,
    lastError: message,
    state: permanent ? 'failed' : 'pending',
  } satisfies WorkspaceMutation)
  await transactionDone(transaction)
}

export async function resetWorkspaceLocalDatabaseForTests(): Promise<void> {
  const database = await databasePromise
  database?.close()
  databasePromise = null
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.addEventListener('success', () => resolve(), { once: true })
    request.addEventListener('error', () => reject(request.error ?? new Error('Could not reset test database.')), {
      once: true,
    })
    request.addEventListener('blocked', () => reject(new Error('Test database reset was blocked.')), { once: true })
  })
}
