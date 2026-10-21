import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select'
import { useLanguage } from '../../localization/language-context'
import { isDateFormat } from '../date-format-preference'
import { useDateFormat } from '../date-format-context'

export function DateFormatSelector() {
  const { t } = useLanguage()
  const { dateFormat, setDateFormat } = useDateFormat()

  return (
    <Select
      value={dateFormat}
      onValueChange={(value) => {
        if (isDateFormat(value)) setDateFormat(value)
      }}
    >
      <SelectTrigger className="settings-select-trigger" aria-label={t('settings', 'dateFormat')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="settings-select-content" align="end" side="bottom" sideOffset={6}>
        <SelectItem value="locale">{t('settings', 'dateFormatLocale')}</SelectItem>
        <SelectItem value="day-month-year">{t('settings', 'dateFormatDayMonthYear')}</SelectItem>
        <SelectItem value="month-day-year">{t('settings', 'dateFormatMonthDayYear')}</SelectItem>
        <SelectItem value="year-month-day">{t('settings', 'dateFormatYearMonthDay')}</SelectItem>
      </SelectContent>
    </Select>
  )
}
