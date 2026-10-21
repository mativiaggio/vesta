import { Globe2 } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select'
import { cn } from '../../../lib/utils'
import { useLanguage } from '../language-context'

type LanguageSelectorProps = {
  className?: string
}

export function LanguageSelector({ className }: LanguageSelectorProps) {
  const { language, setLanguage, t } = useLanguage()

  function handleLanguageChange(value: string) {
    if (value === 'en' || value === 'es') setLanguage(value)
  }

  return (
    <Select value={language} onValueChange={handleLanguageChange}>
      <SelectTrigger className={cn('language-selector-trigger', className)} aria-label={t('language', 'label')}>
        <Globe2 size={14} aria-hidden="true" />
        <span className="language-selector-value">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent className="language-selector-content" align="end" sideOffset={6}>
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
