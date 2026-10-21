import React, { type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { isTauri } from '@tauri-apps/api/core'
import { AppProviders } from './app-providers'
import { configurePreferenceStorage, createMemoryPreferenceStorage } from './features/preferences/preference-store'
import App from './App.tsx'
import { DesktopTitlebar } from './features/desktop/components/desktop-titlebar'
import { DesktopSetupGate } from './features/deployment/components/desktop-setup-gate'
import './styles.css'

const isPackagedDesktop = isTauri() && import.meta.env.MODE !== 'development'

if (isPackagedDesktop) configurePreferenceStorage(createMemoryPreferenceStorage())

if (!isTauri() && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').then(async () => {
      const registration = await navigator.serviceWorker.ready
      const resourceUrls = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((url) => {
          const parsed = new URL(url)
          return parsed.origin === window.location.origin && !parsed.pathname.startsWith('/api/')
        })
      registration.active?.postMessage({ type: 'CACHE_URLS', urls: ['/', ...resourceUrls] })
    })
  })
}

function DesktopWindow({ children }: { children: ReactNode }) {
  return (
    <div className="desktop-app-frame" onContextMenu={(event) => event.preventDefault()}>
      <DesktopTitlebar />
      <div className="desktop-app-content">{children}</div>
    </div>
  )
}

function AppRoot() {
  if (!isTauri()) {
    return (
      <AppProviders>
        <App />
      </AppProviders>
    )
  }

  if (import.meta.env.MODE === 'development') {
    return (
      <AppProviders>
        <DesktopWindow>
          <App />
        </DesktopWindow>
      </AppProviders>
    )
  }

  return (
    <DesktopSetupGate shell={DesktopWindow}>
      <App />
    </DesktopSetupGate>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>,
)
