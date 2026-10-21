import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Button } from '../../../components/ui/button'
import { AppProviders } from '../../../app-providers'
import { readLanguagePreference, saveLanguagePreference } from '../../localization/language-preference'
import { translate } from '../../localization/translations'
import {
  configurePreferenceStorage,
  createMemoryPreferenceStorage,
  readPreference,
} from '../../preferences/preference-store'
import {
  loadThemePreference,
  readThemePreference,
  saveThemePreference,
  type Theme,
} from '../../preferences/theme-preference'
import { DeploymentOnboarding } from './deployment-onboarding'
import { DesktopSetupProvider } from './desktop-setup-context'
import { loadDesktopSetup, loadDefaultDataDirectory, type DesktopSetup } from '../data/desktop-deployment-config'
import { localDesktopPreferenceStorage } from '../data/local-desktop-preference-storage'

type GateState =
  | { kind: 'loading' }
  | { kind: 'setup'; defaultDataDirectory: string }
  | { kind: 'ready'; setup: DesktopSetup }
  | { kind: 'error' }

type DesktopSetupGateProps = {
  children: ReactNode
  shell: ComponentType<{ children: ReactNode }>
}

export function DesktopSetupGate({ children, shell: Shell }: DesktopSetupGateProps) {
  const [gate, setGate] = useState<GateState>({ kind: 'loading' })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [theme, setTheme] = useState<Theme>(readThemePreference)

  useEffect(() => {
    let active = true

    async function loadSetup() {
      setGate({ kind: 'loading' })
      try {
        const setup = await loadDesktopSetup()
        if (!active) return
        if (setup) {
          configurePreferenceStorage(localDesktopPreferenceStorage)
          const storedTheme = await loadThemePreference()
          if (active) {
            setTheme(storedTheme)
            setGate({ kind: 'ready', setup })
          }
          return
        }

        configurePreferenceStorage(createMemoryPreferenceStorage())
        const [defaultDataDirectory, storedTheme] = await Promise.all([
          loadDefaultDataDirectory(),
          loadThemePreference(),
        ])
        if (active) {
          setTheme(storedTheme)
          setGate({ kind: 'setup', defaultDataDirectory })
        }
      } catch {
        if (active) {
          configurePreferenceStorage(createMemoryPreferenceStorage())
          setGate({ kind: 'error' })
        }
      }
    }

    void loadSetup()
    return () => {
      active = false
    }
  }, [loadAttempt])

  async function finishSetup(setup: DesktopSetup, language: 'en' | 'es', selectedTheme: Theme) {
    try {
      configurePreferenceStorage(localDesktopPreferenceStorage)
      const [storedLanguage, storedTheme] = await Promise.all([
        readPreference('vesta.language'),
        readPreference('vesta.theme'),
      ])
      await Promise.all([
        storedLanguage === 'en' || storedLanguage === 'es' ? Promise.resolve() : saveLanguagePreference(language),
        storedTheme === 'light' || storedTheme === 'dark' ? Promise.resolve() : saveThemePreference(selectedTheme),
      ])
      setGate({ kind: 'ready', setup })
    } catch {
      setGate({ kind: 'error' })
    }
  }

  const language = readLanguagePreference()
  if (gate.kind === 'ready') {
    return (
      <DesktopSetupProvider value={gate.setup}>
        <AppProviders key="desktop-ready">
          <Shell>{children}</Shell>
        </AppProviders>
      </DesktopSetupProvider>
    )
  }
  if (gate.kind === 'setup') {
    return (
      <AppProviders key="desktop-onboarding">
        <Shell>
          <DeploymentOnboarding
            defaultDataDirectory={gate.defaultDataDirectory}
            theme={theme}
            onThemeChange={setTheme}
            onConfigured={(setup, selectedLanguage, selectedTheme) => {
              void finishSetup(setup, selectedLanguage, selectedTheme)
            }}
          />
        </Shell>
      </AppProviders>
    )
  }

  if (gate.kind === 'error') {
    return (
      <AppProviders key="desktop-error">
        <Shell>
          <main className={`session-loading deployment-loading-error theme-${theme}`}>
            <div className="deployment-load-error" role="alert">
              <p>{translate(language, 'deployment', 'loadFailed')}</p>
              <Button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
                {translate(language, 'deployment', 'retry')}
              </Button>
            </div>
          </main>
        </Shell>
      </AppProviders>
    )
  }

  return (
    <AppProviders key="desktop-loading">
      <Shell>
        <main className={`session-loading theme-${theme}`} role="status">
          <span className="visually-hidden">{translate(language, 'app', 'opening')}</span>
        </main>
      </Shell>
    </AppProviders>
  )
}
