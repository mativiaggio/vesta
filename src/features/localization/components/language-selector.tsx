import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select'
import { useLanguage } from '../language-context'

export function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage()

  function handleLanguageChange(value: string) {
    if (value === 'en' || value === 'es') setLanguage(value)
  }

  return (
    <Select value={language} onValueChange={handleLanguageChange}>
      <SelectTrigger className="language-selector-trigger" aria-label={t('language', 'label')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="language-selector-content" align="end" sideOffset={6}>
        <SelectItem className="language-selector-option" value="en">{t('language', 'english')}</SelectItem>
        <SelectItem className="language-selector-option" value="es">{t('language', 'spanish')}</SelectItem>
      </SelectContent>
    </Select>
  )
}
