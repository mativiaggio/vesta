import { createAuthClient } from 'better-auth/react'

export const apiBaseUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin)

export const authClient = createAuthClient({
  baseURL: apiBaseUrl,
  fetchOptions: { credentials: 'include' },
})
