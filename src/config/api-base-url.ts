type ApiBaseUrlEnvironment = {
  configuredUrl?: string
  currentOrigin: string
  isDevelopment: boolean
}

export function resolveApiBaseUrl(environment: ApiBaseUrlEnvironment): string {
  const configuredUrl = environment.configuredUrl?.trim()
  if (configuredUrl) return new URL(configuredUrl).origin
  if (environment.isDevelopment) return 'http://localhost:3000'
  return environment.currentOrigin
}
