import React from 'react'
import ReactDOM from 'react-dom/client'
import { isTauri } from '@tauri-apps/api/core'
import App from './App.tsx'
import { DesktopTitlebar } from './features/desktop/components/desktop-titlebar'
import { LanguageProvider } from './features/localization/language-context'
import '@fontsource-variable/manrope'
import './styles.css'

function AppRoot() {
  if (!isTauri()) return <App />

  return (
    <div className="desktop-app-frame" onContextMenu={(event) => event.preventDefault()}>
      <DesktopTitlebar />
      <div className="desktop-app-content"><App /></div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <AppRoot />
    </LanguageProvider>
  </React.StrictMode>,
)
