import { createAuthClient } from 'better-auth/react'
import { apiBaseUrl } from '../../../config/runtime-api-base-url'

export { apiBaseUrl }

export const authClient = createAuthClient({
  baseURL: apiBaseUrl,
  fetchOptions: { credentials: 'include' },
})
