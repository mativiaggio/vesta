import { lazy, Suspense, useEffect, useState } from 'react'
import { authClient } from './features/auth/data/auth-client'
import {
  cacheIdentity,
  clearCachedIdentity,
  readCachedIdentity,
  type CachedIdentity,
} from './features/auth/data/cached-identity'
import { useLanguage } from './features/localization/language-context'
import {
  loadThemePreference,
  readThemePreference,
  saveThemePreference,
  type Theme,
} from './features/preferences/theme-preference'

const AuthExperience = lazy(() =>
  import('./features/auth/components/auth-experience').then((module) => ({
    default: module.AuthExperience,
  })),
)
const WorkspaceExperience = lazy(() =>
  import('./features/workspaces/components/workspace-experience').then((module) => ({
    default: module.WorkspaceExperience,
  })),
)

export default function App() {
  const { data: session, error: sessionError, isPending: isSessionPending, refetch } = authClient.useSession()
  const { t } = useLanguage()
  const [theme, setTheme] = useState<Theme>(readThemePreference)
  const [isThemePreferenceLoaded, setIsThemePreferenceLoaded] = useState(false)
  const [cachedIdentity, setCachedIdentity] = useState<CachedIdentity | null>(null)
  const [isReadingCachedIdentity, setIsReadingCachedIdentity] = useState(true)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [isLocallySignedOut, setIsLocallySignedOut] = useState(false)

  useEffect(() => {
    if (isThemePreferenceLoaded) void saveThemePreference(theme)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#f8f8f6' : '#20201e')
  }, [isThemePreferenceLoaded, theme])

  useEffect(() => {
    let active = true
    void loadThemePreference()
      .then((storedTheme) => {
        if (active) setTheme(storedTheme)
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setIsThemePreferenceLoaded(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true)
      void refetch()
    }
    function handleOffline() {
      setIsOnline(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refetch])

  useEffect(() => {
    if (isOnline && isLocallySignedOut) void authClient.signOut()
  }, [isLocallySignedOut, isOnline])

  useEffect(() => {
    let active = true
    async function updateCachedIdentity() {
      try {
        if (session?.user) {
          const identity = {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            image: session.user.image,
          }
          await cacheIdentity(identity)
          if (active) {
            setCachedIdentity({ ...identity, cachedAt: new Date().toISOString() })
            setIsLocallySignedOut(false)
          }
        } else if (!isSessionPending && (sessionError || !isOnline)) {
          const identity = await readCachedIdentity()
          if (active) setCachedIdentity(identity)
        } else if (!isSessionPending) {
          await clearCachedIdentity()
          if (active) setCachedIdentity(null)
        }
      } catch {
        if (active && !session?.user) setCachedIdentity(null)
      } finally {
        if (active) setIsReadingCachedIdentity(false)
      }
    }
    void updateCachedIdentity()
    return () => {
      active = false
    }
  }, [isOnline, isSessionPending, session?.user, sessionError])

  const loading = (
    <main className={`session-loading theme-${theme}`} role="status">
      <span className="visually-hidden">{t('app', 'opening')}</span>
    </main>
  )

  if (isSessionPending || (isReadingCachedIdentity && !isOnline)) return loading

  const toggleTheme = () => setTheme((current) => (current === 'light' ? 'dark' : 'light'))

  const user = isLocallySignedOut ? null : (session?.user ?? (!isOnline || sessionError ? cachedIdentity : null))

  if (user) {
    return (
      <Suspense fallback={loading}>
        <WorkspaceExperience
          userId={user.id}
          theme={theme}
          onToggleTheme={toggleTheme}
          onSignOut={() => {
            setCachedIdentity(null)
            setIsLocallySignedOut(true)
            void clearCachedIdentity().then(() => (isOnline ? authClient.signOut() : undefined))
          }}
        />
      </Suspense>
    )
  }

  return (
    <Suspense fallback={loading}>
      <AuthExperience theme={theme} onToggleTheme={toggleTheme} />
    </Suspense>
  )
}
