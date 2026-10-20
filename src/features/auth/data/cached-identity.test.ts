import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cacheIdentity,
  clearCachedIdentity,
  readCachedIdentity,
  resetCachedIdentityDatabaseForTests,
} from './cached-identity'

describe('cached identity', () => {
  beforeEach(resetCachedIdentityDatabaseForTests)
  afterEach(resetCachedIdentityDatabaseForTests)

  it('persists only the non-credential identity needed to open local data', async () => {
    await cacheIdentity({ id: 'user-1', name: 'Alex', email: 'alex@example.com', image: null })
    expect(await readCachedIdentity()).toMatchObject({
      id: 'user-1',
      name: 'Alex',
      email: 'alex@example.com',
      image: null,
    })
  })

  it('clears the offline identity on sign out', async () => {
    await cacheIdentity({ id: 'user-1', name: 'Alex', email: 'alex@example.com' })
    await clearCachedIdentity()
    expect(await readCachedIdentity()).toBeNull()
  })
})
