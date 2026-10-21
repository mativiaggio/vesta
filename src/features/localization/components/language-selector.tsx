import type { ComponentProps } from 'react'
import { Globe2 } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select'
import { useLanguage } from '../language-context'

type LanguageSelectorProps = {
  side?: ComponentProps<typeof SelectContent>['side']
  align?: ComponentProps<typeof SelectContent>['align']
}

export function LanguageSelector({ side = 'bottom', align = 'end' }: LanguageSelectorProps) {
  const { language, setLanguage, t } = useLanguage()

  function handleLanguageChange(value: string) {
    if (value === 'en' || value === 'es') setLanguage(value)
  }

  return (
    <Select value={language} onValueChange={handleLanguageChange}>
      <SelectTrigger className="language-selector-trigger" aria-label={t('language', 'label')}>
        <Globe2 size={14} aria-hidden="true" />
        <span className="language-selector-value">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent className="language-selector-content" align={align} side={side} sideOffset={6}>
        <SelectItem className="language-selector-option" value="en">
          {t('language', 'english')}
        </SelectItem>
        <SelectItem className="language-selector-option" value="es">
          {t('language', 'spanish')}
        </SelectItem>
      </SelectContent>
    </Select>
  )
}
