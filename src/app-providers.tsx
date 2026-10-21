import type { ReactNode } from 'react'
import { LanguageProvider } from './features/localization/language-context'
import { DateFormatProvider } from './features/preferences/date-format-context'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <DateFormatProvider>{children}</DateFormatProvider>
    </LanguageProvider>
  )
}
