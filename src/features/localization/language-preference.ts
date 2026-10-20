import type { Language } from './translations'
import { readPreference, writePreference } from '../preferences/preference-store'

const storageKey = 'vesta.language'

export function readLanguagePreference(): Language {
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export async function loadLanguagePreference(): Promise<Language> {
  const value = await readPreference(storageKey)
  return value === 'en' || value === 'es' ? value : readLanguagePreference()
}

export function saveLanguagePreference(language: Language): Promise<void> {
  return writePreference(storageKey, language)
}
