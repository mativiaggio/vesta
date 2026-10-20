import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, LoaderCircle, LogOut, Moon, Sun } from 'lucide-react'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { authClient } from './features/auth/data/auth-client'
import { readThemePreference, saveThemePreference, type Theme } from './features/preferences/theme-preference'

type AuthMode = 'signup' | 'signin' | 'recovery'

export default function App() {
  const { data: session, isPending: isSessionPending } = authClient.useSession()
  const resetQuery = new URLSearchParams(window.location.search)
  const resetToken = resetQuery.get('token')
  const invalidResetLink = resetQuery.get('error') === 'INVALID_TOKEN'
  const [mode, setMode] = useState<AuthMode>(invalidResetLink ? 'signin' : 'signup')
  const [theme, setTheme] = useState<Theme>(readThemePreference)
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(invalidResetLink ? 'This password reset link has expired or was already used. Request a new one.' : '')

  useEffect(() => {
    saveThemePreference(theme)
  }, [theme])

  if (isSessionPending) return <main className="session-loading" aria-label="Opening Vesta" />

  if (session?.user) {
    return (
      <main className="office-ready">
        <div className="office-ready-content">
          <img className="office-ready-logo" src="/brand/logo-vesta.svg" alt="Vesta" />
          <h1>A little more room.</h1>
          <p>Your office is ready. Start with what’s on your mind.</p>
        </div>
        <Button className="signout-button" variant="ghost" size="icon" type="button" aria-label="Sign out" title="Sign out" onClick={() => { void authClient.signOut() }}>
          <LogOut size={17} aria-hidden="true" />
        </Button>
      </main>
    )
  }

  const isSignup = mode === 'signup'
  const isRecovery = mode === 'recovery'
  const isReset = Boolean(resetToken)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setIsSubmitting(true)

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email') ?? '').trim()
    const password = String(formData.get('password') ?? '')
    const confirmPassword = String(formData.get('confirmPassword') ?? '')

    try {
      if ((isSignup || isReset) && password !== confirmPassword) {
        throw new Error('The passwords do not match.')
      }

      if (isReset && resetToken) {
        const result = await authClient.resetPassword({ newPassword: password, token: resetToken })
        if (result.error) throw new Error(result.error.message || 'Could not reset your password.')
        window.history.replaceState({}, '', window.location.pathname)
        setMessage('Your password has been changed. Sign in with your new password.')
        setMode('signin')
        return
      }

      if (isRecovery) {
        const result = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/` })
        if (result.error) throw new Error(result.error.message || 'Could not request password recovery.')
        setMessage('If the account exists, check its configured recovery destination. Self-hosted console links appear only in the server administrator’s console.')
        return
      }

      if (isSignup) {
        const name = String(formData.get('name') ?? '').trim()
        const result = await authClient.signUp.email({ email, password, name })
        if (result.error) throw new Error(result.error.message || 'Could not create your account.')
      } else {
        const result = await authClient.signIn.email({ email, password })
        if (result.error) throw new Error(result.error.message || 'Email or password is incorrect.')
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function switchMode(nextMode: AuthMode) {
    window.history.replaceState({}, '', window.location.pathname)
    setMode(nextMode)
    setMessage('')
    setError('')
    setShowPassword(false)
  }

  const heading = isReset ? 'Choose a new password' : isRecovery ? 'Reset your password' : isSignup ? 'Create your account' : 'Welcome back'
  const subheading = isReset
    ? 'Use at least 10 characters.'
    : isRecovery
      ? 'Request a one-time link to reset your password.'
      : isSignup
        ? 'Start with the essentials. You can make it yours later.'
        : 'Pick up where you left off.'

  return (
    <main className={`auth-shell theme-${theme}`}>
      <section className="brand-panel" aria-label="About Vesta">
        <a className="brand-lockup" href="#home" aria-label="Vesta home">
          <img className="brand-logo" src="/brand/logo-vesta.svg" alt="" />
          <span>Vesta</span>
        </a>
        <div className="brand-story">
          <div className="brand-mark" aria-hidden="true">V</div>
          <h1>Make room for<br /><span>your best work.</span></h1>
          <p>A quiet place for the work that matters.<br />Tasks, documents, and clients. All in one office.</p>
          <div className="brand-note"><span aria-hidden="true" />Made for independent work</div>
        </div>
        <footer className="brand-footer">Vesta <span>·</span> Your work, in good order.</footer>
      </section>

      <section className="form-panel" aria-labelledby="form-title">
        <Button
          variant="ghost"
          size="icon"
          className="theme-toggle"
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          type="button"
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </Button>
        <div className="form-content">
          <header className="form-heading">
            <h2 id="form-title">{heading}</h2>
            <p>{subheading}</p>
          </header>
          <form className="auth-form" onSubmit={(event) => { void handleSubmit(event) }}>
            {isSignup && !isReset && (
              <div className="field-group">
                <label htmlFor="name">Your name</label>
                <Input id="name" name="name" autoComplete="name" placeholder="Alex Morgan" required />
              </div>
            )}
            {!isReset && <div className="field-group">
              <label htmlFor="email">Email address</label>
              <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
            </div>}
            {!isRecovery && (
              <div className="field-group">
                <label htmlFor="password">{isReset ? 'New password' : 'Password'}</label>
                <div className="password-field">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={isReset || isSignup ? 'new-password' : 'current-password'}
                    placeholder={isSignup || isReset ? 'At least 10 characters' : 'Enter your password'}
                    minLength={isSignup || isReset ? 10 : undefined}
                    maxLength={128}
                    required
                  />
                  <Button
                    className="password-toggle"
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </Button>
                </div>
              </div>
            )}
            {(isSignup || isReset) && (
              <div className="field-group">
                <label htmlFor="confirm-password">Confirm password</label>
                <Input
                  id="confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Enter it once more"
                  minLength={10}
                  maxLength={128}
                  required
                />
              </div>
            )}
            {mode === 'signin' && !isReset && <button className="forgot-link" type="button" onClick={() => switchMode('recovery')}>Forgot password?</button>}
            {error && <p className="form-message form-error" role="alert">{error}</p>}
            {message && <p className="form-message" role="status">{message}</p>}
            <Button type="submit" className="submit-button" disabled={isSubmitting}>
              <span>{isSubmitting ? 'Please wait…' : isReset ? 'Save new password' : isRecovery ? 'Send reset link' : isSignup ? 'Create account' : 'Sign in'}</span>
              {isSubmitting ? <LoaderCircle className="loading-icon" size={18} aria-hidden="true" /> : <ArrowRight size={19} aria-hidden="true" />}
            </Button>
          </form>
          <p className="mode-switch">
            {isRecovery || isReset ? 'Remember your password?' : isSignup ? 'Already have an account?' : 'New to Vesta?'}{' '}
            <button type="button" onClick={() => switchMode(isSignup || isRecovery || isReset ? 'signin' : 'signup')}>
              {isSignup || isRecovery || isReset ? 'Sign in' : 'Create an account'}
            </button>
          </p>
          <p className="privacy-note"><span aria-hidden="true" />Your workspace is yours. No feeds, no noise.</p>
        </div>
      </section>
    </main>
  )
}
