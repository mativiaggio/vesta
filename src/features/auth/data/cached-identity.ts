export type CachedIdentity = {
  id: string
  name: string
  email: string
  image?: string | null
  cachedAt: string
}

const databaseName = 'vesta-auth'
const storeName = 'identity'
const currentIdentityKey = 'current'
let databasePromise: Promise<IDBDatabase> | null = null

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
    const request = indexedDB.open(databaseName, 1)
    request.addEventListener(
      'upgradeneeded',
      () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName)
        }
      },
      { once: true },
    )
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener(
      'error',
      () => {
        databasePromise = null
        reject(request.error ?? new Error('Could not open the identity database.'))
      },
      { once: true },
    )
  })
  return databasePromise
}

export async function readCachedIdentity(): Promise<CachedIdentity | null> {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readonly')
  const identity = (await requestResult(transaction.objectStore(storeName).get(currentIdentityKey))) as
    CachedIdentity | undefined
  await transactionDone(transaction)
  return identity ?? null
}

export async function cacheIdentity(identity: Omit<CachedIdentity, 'cachedAt'>): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readwrite')
  transaction.objectStore(storeName).put({ ...identity, cachedAt: new Date().toISOString() }, currentIdentityKey)
  await transactionDone(transaction)
}

export async function clearCachedIdentity(): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readwrite')
  transaction.objectStore(storeName).delete(currentIdentityKey)
  await transactionDone(transaction)
}

export async function resetCachedIdentityDatabaseForTests(): Promise<void> {
  const database = await databasePromise
  database?.close()
  databasePromise = null
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.addEventListener('success', () => resolve(), { once: true })
    request.addEventListener('error', () => reject(request.error ?? new Error('Could not reset test database.')), {
      once: true,
    })
  })
}
