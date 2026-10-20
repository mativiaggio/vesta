import { readPreference, writePreference } from './preference-store'

export type Theme = 'light' | 'dark'

const storageKey = 'vesta.theme'

export function readThemePreference(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export async function loadThemePreference(): Promise<Theme> {
  const value = await readPreference(storageKey)
  return value === 'dark' || value === 'light' ? value : readThemePreference()
}

export function saveThemePreference(theme: Theme): Promise<void> {
  return writePreference(storageKey, theme)
}
