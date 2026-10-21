import * as React from 'react'

export type SidebarContextValue = {
  theme: 'light' | 'dark'
  state: 'expanded' | 'collapsed'
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

export const SidebarContext = React.createContext<SidebarContextValue | null>(null)

export const sidebarToggleEvent = 'vesta:sidebar-toggle'

export function requestSidebarToggle() {
  window.dispatchEvent(new Event(sidebarToggleEvent))
}

export function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider.')
  return context
}
