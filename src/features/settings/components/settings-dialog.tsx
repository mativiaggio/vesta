import { useState } from 'react'
import { SlidersHorizontal, Sun, X } from 'lucide-react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '../../../components/ui/sidebar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select'
import { LanguageSelector } from '../../localization/components/language-selector'
import { useLanguage } from '../../localization/language-context'
import { DateFormatSelector } from '../../preferences/components/date-format-selector'
import { useDateFormat } from '../../preferences/date-format-context'
import type { Theme } from '../../preferences/theme-preference'

type SettingsSection = 'general' | 'appearance'

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  theme: Theme
  onThemeChange: (theme: Theme) => void
}

export function SettingsDialog({ open, onOpenChange, theme, onThemeChange }: SettingsDialogProps) {
  const { t } = useLanguage()
  const [section, setSection] = useState<SettingsSection>('general')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`settings-dialog theme-${theme}`}>
        <DialogHeader className="settings-dialog-header">
          <div>
            <DialogTitle>{t('settings', 'title')}</DialogTitle>
            <DialogDescription>{t('settings', 'description')}</DialogDescription>
          </div>
          <DialogClose className="settings-dialog-close" aria-label={t('settings', 'close')}>
            <X size={16} aria-hidden="true" />
          </DialogClose>
        </DialogHeader>

        <div className="settings-dialog-body">
          <nav className="settings-sidebar" aria-label={t('settings', 'sections')}>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton type="button" isActive={section === 'general'} onClick={() => setSection('general')}>
                  <SlidersHorizontal size={15} aria-hidden="true" />
                  <span>{t('settings', 'general')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  isActive={section === 'appearance'}
                  onClick={() => setSection('appearance')}
                >
                  <Sun size={15} aria-hidden="true" />
                  <span>{t('settings', 'appearance')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </nav>

          <div className="settings-panel" key={section}>
            {section === 'general' ? (
              <GeneralSettings />
            ) : (
              <AppearanceSettings theme={theme} onThemeChange={onThemeChange} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function GeneralSettings() {
  const { t } = useLanguage()
  const { formatDate } = useDateFormat()
  const sampleDate = new Date(2026, 4, 21, 12)

  return (
    <section aria-labelledby="settings-general-title">
      <div className="settings-section-heading">
        <h2 id="settings-general-title">{t('settings', 'general')}</h2>
        <p>{t('settings', 'generalDescription')}</p>
      </div>
      <div className="settings-preference-row settings-language-row">
        <div className="settings-preference-copy">
          <h3>{t('settings', 'language')}</h3>
          <p>{t('settings', 'languageDescription')}</p>
        </div>
        <LanguageSelector className="settings-language-trigger" />
      </div>
      <div className="settings-preference-row settings-date-format-row">
        <div className="settings-preference-copy">
          <h3>{t('settings', 'dateFormat')}</h3>
          <p>{t('settings', 'dateFormatDescription')}</p>
          <p className="settings-date-preview">
            <span>{t('settings', 'dateFormatPreview')}</span>
            <strong>{formatDate(sampleDate)}</strong>
          </p>
        </div>
        <DateFormatSelector />
      </div>
    </section>
  )
}

function AppearanceSettings({ theme, onThemeChange }: { theme: Theme; onThemeChange: (theme: Theme) => void }) {
  const { t } = useLanguage()

  return (
    <section aria-labelledby="settings-appearance-title">
      <div className="settings-section-heading">
        <h2 id="settings-appearance-title">{t('settings', 'appearance')}</h2>
        <p>{t('settings', 'appearanceDescription')}</p>
      </div>
      <div className="settings-preference-row">
        <div className="settings-preference-copy">
          <h3>{t('settings', 'theme')}</h3>
          <p>{t('settings', 'themeDescription')}</p>
        </div>
        <ThemeSelector theme={theme} onThemeChange={onThemeChange} />
      </div>
    </section>
  )
}

function ThemeSelector({ theme, onThemeChange }: { theme: Theme; onThemeChange: (theme: Theme) => void }) {
  const { t } = useLanguage()

  return (
    <Select
      value={theme}
      onValueChange={(value) => {
        if (value === 'light' || value === 'dark') onThemeChange(value)
      }}
    >
      <SelectTrigger className="settings-select-trigger" aria-label={t('settings', 'theme')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className={`settings-select-content theme-${theme}`} align="end" side="bottom" sideOffset={6}>
        <SelectItem value="light">{t('settings', 'themeLight')}</SelectItem>
        <SelectItem value="dark">{t('settings', 'themeDark')}</SelectItem>
      </SelectContent>
    </Select>
  )
}
