export type Theme = 'light' | 'dark'

const storageKey = 'vesta.theme'

export function readThemePreference(): Theme {
  try {
    return window.localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function saveThemePreference(theme: Theme): void {
  try {
    window.localStorage.setItem(storageKey, theme)
  } catch {
    // Keep the selected theme for the current session if storage is unavailable.
  }
}
