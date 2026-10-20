type ApiBaseUrlEnvironment = {
  configuredUrl?: string
  currentOrigin: string
  isDevelopment: boolean
  isDesktop: boolean
}

export function resolveApiBaseUrl(environment: ApiBaseUrlEnvironment): string {
  const configuredUrl = environment.configuredUrl?.trim()
  if (configuredUrl) return new URL(configuredUrl).origin
  if (environment.isDevelopment) return 'http://localhost:3000'
  if (environment.isDesktop) throw new Error('VITE_API_URL is required in packaged desktop builds.')
  return environment.currentOrigin
}
