import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPreference, resetPreferenceDatabaseForTests, writePreference } from './preference-store'

describe('preference store', () => {
  beforeEach(resetPreferenceDatabaseForTests)
  afterEach(resetPreferenceDatabaseForTests)

  it('persists user preferences outside localStorage', async () => {
    await writePreference('vesta.language', 'es')
    expect(await readPreference('vesta.language')).toBe('es')
  })
})
