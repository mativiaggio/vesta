import { afterEach, describe, expect, it } from 'vitest'
import { configurePreferenceStorage, createMemoryPreferenceStorage } from '../../preferences/preference-store'
import {
  loadTicketDetailPresentationPreference,
  saveTicketDetailPresentationPreference,
} from './ticket-view-preference'

describe('ticket detail presentation preference', () => {
  afterEach(() => configurePreferenceStorage(null))

  it('defaults to a modal and remembers the selected presentation', async () => {
    configurePreferenceStorage(createMemoryPreferenceStorage())

    expect(await loadTicketDetailPresentationPreference()).toBe('modal')

    await saveTicketDetailPresentationPreference('fullscreen')
    expect(await loadTicketDetailPresentationPreference()).toBe('fullscreen')

    await saveTicketDetailPresentationPreference('modal')
    expect(await loadTicketDetailPresentationPreference()).toBe('modal')
  })
})
