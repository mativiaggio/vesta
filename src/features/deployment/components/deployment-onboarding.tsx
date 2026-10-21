import { useState } from 'react'
import { ArrowLeft, ArrowRight, Cloud, FolderOpen, HardDrive, Moon, Sun } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { LanguageSelector } from '../../localization/components/language-selector'
import { useLanguage } from '../../localization/language-context'
import type { Theme } from '../../preferences/theme-preference'
import { chooseDataDirectory, saveSelfManagedSetup, type DesktopSetup } from '../data/desktop-deployment-config'
import './deployment-onboarding.css'

type OnboardingStep = 'deployment' | 'location'
type SetupError = 'choose' | 'save'

type DeploymentOnboardingProps = {
  defaultDataDirectory: string
  theme: Theme
  onThemeChange: (theme: Theme) => void
  onConfigured: (setup: DesktopSetup, language: 'en' | 'es', theme: Theme) => void
}

export function DeploymentOnboarding({
  defaultDataDirectory,
  theme,
  onThemeChange,
  onConfigured,
}: DeploymentOnboardingProps) {
  const { language, t } = useLanguage()
  const [step, setStep] = useState<OnboardingStep>('deployment')
  const [dataDirectory, setDataDirectory] = useState(defaultDataDirectory)
  const [isChoosingDirectory, setIsChoosingDirectory] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<SetupError | null>(null)

  async function handleChooseDirectory() {
    setError(null)
    setIsChoosingDirectory(true)
    try {
      const selectedDirectory = await chooseDataDirectory(dataDirectory, t('deployment', 'folderDialogTitle'))
      if (selectedDirectory) setDataDirectory(selectedDirectory)
    } catch {
      setError('choose')
    } finally {
      setIsChoosingDirectory(false)
    }
  }

  async function handleSaveLocation() {
    setError(null)
    setIsSaving(true)
    try {
      const setup = await saveSelfManagedSetup(dataDirectory)
      setIsSaving(false)
      onConfigured(setup, language, theme)
    } catch {
      setError('save')
      setIsSaving(false)
    }
  }

  return (
    <main className={`auth-shell deployment-onboarding theme-${theme}`}>
      <aside className="brand-panel">
        <div className="brand-lockup">
          <img className="brand-logo" src="/brand/logo-vesta.svg" alt="" aria-hidden="true" />
          <span>Vesta</span>
        </div>
        <section className="brand-story">
          <h2 className="brand-headline">
            {t('brand', 'headingFirst')} <span>{t('brand', 'headingSecond')}</span>
          </h2>
          <p>{t('brand', 'descriptionFirst')}</p>
          <p>{t('brand', 'descriptionSecond')}</p>
        </section>
        <footer className="brand-footer">{t('brand', 'footer')}</footer>
      </aside>

      <section className="form-panel deployment-form-panel">
        <div className="auth-controls deployment-controls">
          <LanguageSelector />
          <Button
            className="theme-toggle"
            variant="ghost"
            size="icon"
            type="button"
            aria-label={theme === 'light' ? t('app', 'switchToDark') : t('app', 'switchToLight')}
            title={theme === 'light' ? t('app', 'switchToDark') : t('app', 'switchToLight')}
            onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}
          >
            {theme === 'light' ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
          </Button>
        </div>

        <div className="form-content deployment-form-content">
          {step === 'deployment' ? (
            <section aria-labelledby="deployment-heading">
              <header className="deployment-heading">
                <h1 id="deployment-heading">{t('deployment', 'chooseModeHeading')}</h1>
                <p>{t('deployment', 'chooseModeDescription')}</p>
              </header>

              <div className="deployment-options">
                <Button className="deployment-option is-disabled" variant="ghost" type="button" disabled>
                  <span className="deployment-option-icon" aria-hidden="true">
                    <Cloud size={18} />
                  </span>
                  <span className="deployment-option-copy">
                    <strong>{t('deployment', 'cloud')}</strong>
                    <span>{t('deployment', 'cloudDescription')}</span>
                  </span>
                  <span className="deployment-option-status">{t('deployment', 'comingSoon')}</span>
                </Button>

                <Button
                  className="deployment-option"
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setError(null)
                    setStep('location')
                  }}
                >
                  <span className="deployment-option-icon" aria-hidden="true">
                    <HardDrive size={18} />
                  </span>
                  <span className="deployment-option-copy">
                    <strong>{t('deployment', 'selfManaged')}</strong>
                    <span>{t('deployment', 'selfManagedDescription')}</span>
                  </span>
                  <ArrowRight className="deployment-option-arrow" size={17} aria-hidden="true" />
                </Button>
              </div>
            </section>
          ) : (
            <section aria-labelledby="deployment-location-heading">
              <Button
                className="deployment-back"
                variant="ghost"
                type="button"
                onClick={() => {
                  setError(null)
                  setStep('deployment')
                }}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                {t('deployment', 'back')}
              </Button>

              <header className="deployment-heading">
                <h1 id="deployment-location-heading">{t('deployment', 'locationHeading')}</h1>
                <p>{t('deployment', 'locationDescription')}</p>
              </header>

              <div className="deployment-directory-field">
                <label htmlFor="deployment-data-directory">{t('deployment', 'folderLabel')}</label>
                <div className="deployment-directory-control">
                  <Input
                    id="deployment-data-directory"
                    value={dataDirectory}
                    readOnly
                    title={dataDirectory}
                    dir="ltr"
                    aria-describedby="deployment-directory-help"
                  />
                  <Button
                    className="deployment-choose-folder"
                    variant="ghost"
                    size="icon"
                    type="button"
                    disabled={isChoosingDirectory || isSaving}
                    aria-label={t('deployment', 'chooseFolder')}
                    title={t('deployment', 'chooseFolder')}
                    onClick={() => void handleChooseDirectory()}
                  >
                    <FolderOpen size={17} aria-hidden="true" />
                  </Button>
                </div>
                <p id="deployment-directory-help" className="deployment-directory-help">
                  {t('deployment', 'defaultLocation')}
                </p>
              </div>

              <p className="deployment-note">{t('deployment', 'folderScopeNotice')}</p>
              <p className="deployment-note is-build-note">{t('deployment', 'setupStageNotice')}</p>
              {error && (
                <p className="deployment-error" role="alert">
                  {t('deployment', error === 'choose' ? 'chooseFailed' : 'saveFailed')}
                </p>
              )}
              <Button
                className="deployment-save-button"
                type="button"
                disabled={!dataDirectory.trim() || isChoosingDirectory || isSaving}
                onClick={() => void handleSaveLocation()}
              >
                {isSaving ? t('deployment', 'savingLocation') : t('deployment', 'saveLocation')}
                {!isSaving && <ArrowRight size={16} aria-hidden="true" />}
              </Button>
            </section>
          )}
        </div>
      </section>
    </main>
  )
}
