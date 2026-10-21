import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLanguage } from '../localization/language-context'
import {
  formatDate as formatDateValue,
  loadDateFormatPreference,
  saveDateFormatPreference,
  type DateFormat,
} from './date-format-preference'

type DateFormatContextValue = {
  dateFormat: DateFormat
  setDateFormat: (format: DateFormat) => void
  formatDate: (date: Date) => string
}

const DateFormatContext = createContext<DateFormatContextValue | null>(null)

export function DateFormatProvider({ children }: { children: ReactNode }) {
  const { language } = useLanguage()
  const [dateFormat, setDateFormatState] = useState<DateFormat>('locale')
  const [isPreferenceLoaded, setIsPreferenceLoaded] = useState(false)

  useEffect(() => {
    let active = true
    void loadDateFormatPreference()
      .then((storedFormat) => {
        if (active) setDateFormatState(storedFormat)
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setIsPreferenceLoaded(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (isPreferenceLoaded) void saveDateFormatPreference(dateFormat)
  }, [dateFormat, isPreferenceLoaded])

  const setDateFormat = useCallback((format: DateFormat) => setDateFormatState(format), [])
  const format = useCallback((date: Date) => formatDateValue(date, language, dateFormat), [dateFormat, language])
  const value = useMemo(() => ({ dateFormat, setDateFormat, formatDate: format }), [dateFormat, format, setDateFormat])

  return <DateFormatContext.Provider value={value}>{children}</DateFormatContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- Keep the preference hook beside its provider.
export function useDateFormat(): DateFormatContextValue {
  const context = useContext(DateFormatContext)
  if (!context) throw new Error('useDateFormat must be used within a DateFormatProvider')
  return context
}
