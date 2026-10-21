const databaseName = 'vesta-preferences'
const storeName = 'preferences'
let databasePromise: Promise<IDBDatabase> | null = null

export type PreferenceStorageAdapter = {
  read: (key: string) => Promise<unknown>
  write: (key: string, value: string) => Promise<void>
}

let configuredAdapter: PreferenceStorageAdapter | null = null

export function configurePreferenceStorage(adapter: PreferenceStorageAdapter | null): void {
  configuredAdapter = adapter
}

export function createMemoryPreferenceStorage(): PreferenceStorageAdapter {
  const values = new Map<string, string>()
  return {
    read: (key) => Promise.resolve(values.get(key)),
    write: (key, value) => {
      values.set(key, value)
      return Promise.resolve()
    },
  }
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
    const request = indexedDB.open(databaseName, 1)
    request.addEventListener(
      'upgradeneeded',
      () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName)
      },
      { once: true },
    )
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener(
      'error',
      () => {
        databasePromise = null
        reject(request.error ?? new Error('Could not open the preferences database.'))
      },
      { once: true },
    )
  })
  return databasePromise
}

export async function readPreference(key: string): Promise<unknown> {
  if (configuredAdapter) return configuredAdapter.read(key)
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readonly')
  const value: unknown = await requestResult<unknown>(transaction.objectStore(storeName).get(key))
  await transactionDone(transaction)
  return value
}

export async function writePreference(key: string, value: string): Promise<void> {
  if (configuredAdapter) {
    await configuredAdapter.write(key, value)
    return
  }
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readwrite')
  transaction.objectStore(storeName).put(value, key)
  await transactionDone(transaction)
}

export async function resetPreferenceDatabaseForTests(): Promise<void> {
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
