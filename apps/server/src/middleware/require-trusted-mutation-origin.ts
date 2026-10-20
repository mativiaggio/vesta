import { createMiddleware } from 'hono/factory'

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

function normalizeOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin)
    if (parsed.pathname !== '' && parsed.pathname !== '/') return null
    if (parsed.search || parsed.hash || parsed.username || parsed.password) return null
    return parsed.origin === 'null'
      ? `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}`
      : parsed.origin.toLowerCase()
  } catch {
    return null
  }
}

export function createRequireTrustedMutationOrigin(trustedOrigins: readonly string[]) {
  const normalizedTrustedOrigins = new Set(trustedOrigins.map(normalizeOrigin).filter((origin) => origin !== null))

  return createMiddleware(async (context, next) => {
    if (safeMethods.has(context.req.method.toUpperCase())) {
      await next()
      return
    }

    const requestOrigin = context.req.header('Origin')
    const normalizedRequestOrigin = requestOrigin ? normalizeOrigin(requestOrigin) : null
    if (!normalizedRequestOrigin || !normalizedTrustedOrigins.has(normalizedRequestOrigin)) {
      return context.json({ error: 'Forbidden request origin.' }, 403)
    }

    await next()
  })
}
