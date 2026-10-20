import { isTauri } from '@tauri-apps/api/core'
import { resolveApiBaseUrl } from './api-base-url'

export const apiBaseUrl = resolveApiBaseUrl({
  configuredUrl: import.meta.env.VITE_API_URL,
  currentOrigin: window.location.origin,
  isDevelopment: import.meta.env.DEV,
  isDesktop: isTauri(),
})
