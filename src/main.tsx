import React from 'react'
import ReactDOM from 'react-dom/client'
import { isTauri } from '@tauri-apps/api/core'
import App from './App.tsx'
import { DesktopTitlebar } from './features/desktop/components/desktop-titlebar'
import { LanguageProvider } from './features/localization/language-context'
import { DateFormatProvider } from './features/preferences/date-format-context'
import './styles.css'

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

function AppRoot() {
  if (!isTauri()) return <App />

  return (
    <div className="desktop-app-frame" onContextMenu={(event) => event.preventDefault()}>
      <DesktopTitlebar />
      <div className="desktop-app-content">
        <App />
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <DateFormatProvider>
        <AppRoot />
      </DateFormatProvider>
    </LanguageProvider>
  </React.StrictMode>,
)
