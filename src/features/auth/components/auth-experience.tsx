import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, LoaderCircle, Moon, Sun } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { LanguageSelector } from '../../localization/components/language-selector'
import { useLanguage } from '../../localization/language-context'
import type { translations } from '../../localization/translations'
import type { Theme } from '../../preferences/theme-preference'
import { readResetLink } from '../application/reset-link-state'
import { authClient } from '../data/auth-client'

type AuthMode = 'signup' | 'signin' | 'recovery'
type FeedbackKey = keyof typeof translations.en.feedback

function formString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function isAuthMode(value: unknown): value is AuthMode {
  return value === 'signup' || value === 'signin' || value === 'recovery'
}

type AuthExperienceProps = { theme: Theme; onToggleTheme: () => void }

export function AuthExperience({ theme, onToggleTheme }: AuthExperienceProps) {
  const { language, t } = useLanguage()
  const initialResetLink = readResetLink(window.location.search)
  const [resetToken, setResetToken] = useState<string | null>(initialResetLink.token)
  const [mode, setMode] = useState<AuthMode>('signin')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<FeedbackKey | null>(null)
  const [error, setError] = useState<FeedbackKey | null>(initialResetLink.invalid ? 'invalidReset' : null)

  useEffect(() => {
    function handleHistoryNavigation(event: PopStateEvent) {
      const resetLink = readResetLink(window.location.search)
      setResetToken(resetLink.token)
      const state: unknown = event.state
      if (typeof state === 'object' && state !== null && 'vestaAuthMode' in state && isAuthMode(state.vestaAuthMode)) {
        setMode(state.vestaAuthMode)
      } else {
        setMode('signin')
      }
      setError(resetLink.invalid ? 'invalidReset' : null)
      setMessage(null)
    }

    window.addEventListener('popstate', handleHistoryNavigation)
    return () => window.removeEventListener('popstate', handleHistoryNavigation)
  }, [])

  const isSignup = mode === 'signup'
  const isRecovery = mode === 'recovery'
  const isReset = Boolean(resetToken)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setIsSubmitting(true)

    const formData = new FormData(event.currentTarget)
    const email = formString(formData, 'email').trim()
    const password = formString(formData, 'password')
    const confirmPassword = formString(formData, 'confirmPassword')

    try {
      if ((isSignup || isReset) && password !== confirmPassword) {
        setError('passwordMismatch')
        return
      }

      if (isReset && resetToken) {
        const result = await authClient.resetPassword({ newPassword: password, token: resetToken })
        if (result.error) {
          setError('resetFailed')
          return
        }
        window.history.replaceState({}, '', window.location.pathname)
        setResetToken(null)
        setMessage('passwordChanged')
        setMode('signin')
        return
      }

      if (isRecovery) {
        const result = await authClient.requestPasswordReset(
          { email, redirectTo: `${window.location.origin}/` },
          { headers: { 'X-Vesta-Language': language } },
        )
        if (result.error) {
          setError('recoveryFailed')
          return
        }
        setMessage('recoveryRequested')
        return
      }

      if (isSignup) {
        const name = formString(formData, 'name').trim()
        const result = await authClient.signUp.email({ email, password, name })
        if (result.error) {
          setError('signupFailed')
          return
        }
      } else {
        const result = await authClient.signIn.email({ email, password })
        if (result.error) {
          setError('signinFailed')
          return
        }
      }
    } catch {
      setError('genericError')
    } finally {
      setIsSubmitting(false)
    }
  }

  function switchMode(nextMode: AuthMode) {
    window.history.pushState({ vestaAuthMode: nextMode }, '', window.location.pathname)
    setResetToken(null)
    setMode(nextMode)
    setMessage(null)
    setError(null)
    setShowPassword(false)
  }

  const heading = isReset
    ? t('auth', 'choosePassword')
    : isRecovery
      ? t('auth', 'resetPassword')
      : isSignup
        ? t('auth', 'createAccount')
        : t('auth', 'welcomeBack')
  const subheading = isReset
    ? t('auth', 'passwordLength')
    : isRecovery
      ? t('auth', 'recoveryDescription')
      : isSignup
        ? t('auth', 'signupDescription')
        : t('auth', 'signinDescription')

  return (
    <main className={`auth-shell theme-${theme}`}>
      <section className="brand-panel" aria-label={t('app', 'about')}>
        <a className="brand-lockup" href="/" aria-label={t('app', 'home')}>
          <img className="brand-logo" src="/brand/logo-vesta.svg" alt="" />
          <span>Vesta</span>
        </a>
        <div className="brand-story">
          <div className="brand-headline">
            {t('brand', 'headingFirst')}
            <br />
            <span>{t('brand', 'headingSecond')}</span>
          </div>
          <p>
            {t('brand', 'descriptionFirst')}
            <br />
            {t('brand', 'descriptionSecond')}
          </p>
          <div className="brand-note">
            <span aria-hidden="true" />
            {t('brand', 'note')}
          </div>
        </div>
        <footer className="brand-footer">
          Vesta <span>·</span> {t('brand', 'footer')}
        </footer>
      </section>

      <section className="form-panel" aria-labelledby="form-title">
        <div className="auth-controls">
          <LanguageSelector />
          <Button
            variant="ghost"
            size="icon"
            className="theme-toggle"
            aria-label={theme === 'light' ? t('app', 'switchToDark') : t('app', 'switchToLight')}
            onClick={onToggleTheme}
            type="button"
          >
            {theme === 'light' ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
          </Button>
        </div>
        <div className="form-content">
          <header className="form-heading">
            <h1 id="form-title">{heading}</h1>
            <p>{subheading}</p>
          </header>
          <form
            className="auth-form"
            onSubmit={(event) => {
              void handleSubmit(event)
            }}
          >
            {isSignup && !isReset && (
              <div className="field-group">
                <label htmlFor="name">{t('auth', 'name')}</label>
                <Input id="name" name="name" autoComplete="name" placeholder={t('auth', 'namePlaceholder')} required />
              </div>
            )}
            {!isReset && (
              <div className="field-group">
                <label htmlFor="email">{t('auth', 'email')}</label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                />
              </div>
            )}
            {!isRecovery && (
              <div className="field-group">
                <label htmlFor="password">{isReset ? t('auth', 'newPassword') : t('auth', 'password')}</label>
                <div className="password-field">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={isReset || isSignup ? 'new-password' : 'current-password'}
                    placeholder={isSignup || isReset ? t('auth', 'passwordPlaceholder') : t('auth', 'enterPassword')}
                    minLength={isSignup || isReset ? 10 : undefined}
                    maxLength={128}
                    required
                  />
                  <Button
                    className="password-toggle"
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={showPassword ? t('auth', 'hidePassword') : t('auth', 'showPassword')}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </Button>
                </div>
              </div>
            )}
            {(isSignup || isReset) && (
              <div className="field-group">
                <label htmlFor="confirm-password">{t('auth', 'confirmPassword')}</label>
                <Input
                  id="confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  placeholder={t('auth', 'confirmPasswordPlaceholder')}
                  minLength={10}
                  maxLength={128}
                  required
                />
              </div>
            )}
            {mode === 'signin' && !isReset && (
              <button className="forgot-link" type="button" onClick={() => switchMode('recovery')}>
                {t('auth', 'forgotPassword')}
              </button>
            )}
            {error && (
              <p className="form-message form-error" role="alert">
                {t('feedback', error)}
              </p>
            )}
            {message && (
              <p className="form-message" role="status">
                {t('feedback', message)}
              </p>
            )}
            <Button type="submit" className="submit-button" disabled={isSubmitting}>
              <span>
                {isSubmitting
                  ? t('auth', 'pleaseWait')
                  : isReset
                    ? t('auth', 'savePassword')
                    : isRecovery
                      ? t('auth', 'sendResetLink')
                      : isSignup
                        ? t('auth', 'createAccountAction')
                        : t('auth', 'signIn')}
              </span>
              {isSubmitting ? (
                <LoaderCircle className="loading-icon" size={16} aria-hidden="true" />
              ) : (
                <ArrowRight size={17} aria-hidden="true" />
              )}
            </Button>
          </form>
          <p className="mode-switch">
            {isRecovery || isReset
              ? t('auth', 'rememberPassword')
              : isSignup
                ? t('auth', 'alreadyHaveAccount')
                : t('auth', 'newToVesta')}{' '}
            <button type="button" onClick={() => switchMode(isSignup || isRecovery || isReset ? 'signin' : 'signup')}>
              {isSignup || isRecovery || isReset ? t('auth', 'signIn') : t('auth', 'createAccountLink')}
            </button>
          </p>
          <p className="privacy-note">
            <span aria-hidden="true" />
            {t('auth', 'privacyNote')}
          </p>
        </div>
      </section>
    </main>
  )
}
