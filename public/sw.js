const cacheName = 'vesta-shell-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys()
      await Promise.all(cacheNames.filter((name) => name !== cacheName).map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_URLS' || !Array.isArray(event.data.urls)) return
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName)
      for (const value of event.data.urls) {
        if (typeof value !== 'string') continue
        const url = new URL(value, self.location.origin)
        if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) continue
        try {
          await cache.add(url.href)
        } catch {
          // A single optional asset must not prevent the rest of the shell from being cached.
        }
      }
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          if (response.ok) (await caches.open(cacheName)).put('/', response.clone())
          return response
        } catch {
          return (await caches.match('/')) ?? Response.error()
        }
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) (await caches.open(cacheName)).put(request, response.clone())
      return response
    })(),
  )
})
