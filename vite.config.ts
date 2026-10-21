import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')
  const appVersion = environment.VITE_APP_VERSION?.trim() || process.env.npm_package_version

  if (!appVersion) throw new Error('VITE_APP_VERSION or the package version is required.')

  if (mode === 'desktop') {
    const apiUrl = environment.VITE_API_URL?.trim()
    if (!apiUrl) throw new Error('VITE_API_URL is required for packaged desktop builds.')

    const parsedApiUrl = new URL(apiUrl)
    const isLocalDevelopmentUrl = parsedApiUrl.hostname === 'localhost' || parsedApiUrl.hostname === '127.0.0.1'
    if (parsedApiUrl.protocol !== 'https:' && !isLocalDevelopmentUrl) {
      throw new Error('Desktop API URLs must use HTTPS unless they target localhost.')
    }
    if (
      parsedApiUrl.pathname !== '/' ||
      parsedApiUrl.search ||
      parsedApiUrl.hash ||
      parsedApiUrl.username ||
      parsedApiUrl.password
    ) {
      throw new Error('VITE_API_URL must be an origin without credentials, a path, a query, or a fragment.')
    }
  }

  return {
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    },
    plugins: [react(), tailwindcss()],
    server: { watch: { ignored: ['**/src-tauri/**'] } },
    build: {
      manifest: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('better-auth') || id.includes('@better-auth') || id.includes('@better-fetch'))
              return 'vendor-auth'
            if (
              id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/') ||
              id.includes('/node_modules/scheduler/')
            )
              return 'vendor-react'
            if (id.includes('/zod/')) return 'vendor-validation'
            if (id.includes('@radix-ui') || id.includes('@base-ui/react')) return 'vendor-ui'
            if (id.includes('lucide-react')) return 'vendor-icons'
            return undefined
          },
        },
      },
    },
  }
})
