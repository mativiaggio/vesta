import { useEffect, useState, type MouseEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { ArrowLeft, ArrowRight, Copy, Minus, PanelLeft, Square, X } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { requestSidebarToggle } from '../../../components/ui/sidebar-context'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu'
import { useLanguage } from '../../localization/language-context'

const minZoom = 0.6
const maxZoom = 2
const zoomStep = 0.1

export function DesktopTitlebar() {
  const { t } = useLanguage()
  const [isMaximized, setIsMaximized] = useState(false)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const appWindow = getCurrentWindow()
    let disposed = false
    let unlisten: (() => void) | undefined

    void appWindow.isMaximized().then((maximized) => {
      if (!disposed) setIsMaximized(maximized)
    })
    void appWindow
      .onResized(() => {
        void appWindow.isMaximized().then((maximized) => {
          if (!disposed) setIsMaximized(maximized)
        })
      })
      .then((stopListening) => {
        if (disposed) stopListening()
        else unlisten = stopListening
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  function changeZoom(nextZoom: number) {
    const boundedZoom = Math.min(maxZoom, Math.max(minZoom, Number(nextZoom.toFixed(1))))
    setZoom(boundedZoom)
  }

  useEffect(() => {
    const root = document.documentElement
    const scale = String(1 / zoom)
    root.style.setProperty('--desktop-ui-scale', scale)
    if (zoom >= 1.25) root.dataset.uiZoom = 'large'
    else delete root.dataset.uiZoom
    void getCurrentWebview().setZoom(zoom)
    return () => {
      root.style.removeProperty('--desktop-ui-scale')
      delete root.dataset.uiZoom
    }
  }, [zoom])

  function startWindowDrag(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('button, a, input, [role="menuitem"]')) return
    event.preventDefault()
    void getCurrentWindow().startDragging()
  }

  function maximizeOnDoubleClick(event: MouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest('button, a, input, [role="menuitem"]')) return
    void getCurrentWindow().toggleMaximize()
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault()
        window.history.back()
        return
      }
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault()
        window.history.forward()
        return
      }
      if (!event.ctrlKey || event.altKey || event.metaKey) return

      if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        changeZoom(zoom + zoomStep)
      } else if (event.key === '-') {
        event.preventDefault()
        changeZoom(zoom - zoomStep)
      } else if (event.key === '0') {
        event.preventDefault()
        changeZoom(1)
      } else if (event.key === '[') {
        event.preventDefault()
        window.history.back()
      } else if (event.key === ']') {
        event.preventDefault()
        window.history.forward()
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [zoom])

  return (
    <header className="desktop-titlebar" onMouseDown={startWindowDrag} onDoubleClick={maximizeOnDoubleClick}>
      <div className="titlebar-brand">
        <img src="/brand/logo-vesta.svg" alt="" aria-hidden="true" />
        <span>Vesta</span>
      </div>

      <nav className="titlebar-navigation" aria-label={t('desktop', 'navigation')}>
        <Button
          className="titlebar-action desktop-sidebar-toggle"
          variant="ghost"
          size="icon"
          type="button"
          aria-label={t('navigation', 'toggleSidebar')}
          title={t('navigation', 'toggleSidebar')}
          onClick={requestSidebarToggle}
        >
          <PanelLeft size={17} aria-hidden="true" />
        </Button>
        <Button
          className="titlebar-action"
          variant="ghost"
          size="icon"
          type="button"
          aria-label={t('desktop', 'back')}
          title={t('desktop', 'back')}
          onClick={() => window.history.back()}
        >
          <ArrowLeft size={17} aria-hidden="true" />
        </Button>
        <Button
          className="titlebar-action"
          variant="ghost"
          size="icon"
          type="button"
          aria-label={t('desktop', 'forward')}
          title={t('desktop', 'forward')}
          onClick={() => window.history.forward()}
        >
          <ArrowRight size={17} aria-hidden="true" />
        </Button>
        <span className="titlebar-divider" aria-hidden="true" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="titlebar-menu-trigger" variant="ghost" type="button">
              {t('desktop', 'view')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => window.history.back()}>
              <span>{t('desktop', 'back')}</span>
              <kbd>Alt ←</kbd>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.history.forward()}>
              <span>{t('desktop', 'forward')}</span>
              <kbd>Alt →</kbd>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => changeZoom(zoom + zoomStep)}>
              <span>{t('desktop', 'zoomIn')}</span>
              <kbd>Ctrl +</kbd>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => changeZoom(zoom - zoomStep)}>
              <span>{t('desktop', 'zoomOut')}</span>
              <kbd>Ctrl −</kbd>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => changeZoom(1)}>
              <span>{t('desktop', 'actualSize')}</span>
              <kbd>Ctrl 0</kbd>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      <div className="titlebar-drag-space" />

      <div className="titlebar-window-controls">
        <Button
          className="window-control"
          variant="ghost"
          size="icon"
          type="button"
          aria-label={t('desktop', 'minimize')}
          title={t('desktop', 'minimize')}
          onClick={() => {
            void getCurrentWindow().minimize()
          }}
        >
          <Minus size={15} aria-hidden="true" />
        </Button>
        <Button
          className="window-control"
          variant="ghost"
          size="icon"
          type="button"
          aria-label={isMaximized ? t('desktop', 'restore') : t('desktop', 'maximize')}
          title={isMaximized ? t('desktop', 'restore') : t('desktop', 'maximize')}
          onClick={() => {
            void getCurrentWindow().toggleMaximize()
          }}
        >
          {isMaximized ? <Copy size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
        </Button>
        <Button
          className="window-control window-close"
          variant="ghost"
          size="icon"
          type="button"
          aria-label={t('desktop', 'close')}
          title={t('desktop', 'close')}
          onClick={() => {
            void getCurrentWindow().close()
          }}
        >
          <X size={16} aria-hidden="true" />
        </Button>
      </div>
    </header>
  )
}
