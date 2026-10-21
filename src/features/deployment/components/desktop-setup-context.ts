import { createContext, useContext } from 'react'
import type { DesktopSetup } from '../data/desktop-deployment-config'

const DesktopSetupContext = createContext<DesktopSetup | null>(null)

export const DesktopSetupProvider = DesktopSetupContext.Provider

export function useDesktopSetup(): DesktopSetup | null {
  return useContext(DesktopSetupContext)
}
