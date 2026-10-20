import type { Language } from './translations'

const storageKey = 'vesta.language'

export function readLanguagePreference(): Language {
  try {
    const savedLanguage = window.localStorage.getItem(storageKey)
    if (savedLanguage === 'en' || savedLanguage === 'es') return savedLanguage
  } catch {
    // Fall back to the browser language when storage is unavailable.
  }

  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function saveLanguagePreference(language: Language): void {
  try {
    window.localStorage.setItem(storageKey, language)
  } catch {
    // Keep the selected language for the current session if storage is unavailable.
  }
}
