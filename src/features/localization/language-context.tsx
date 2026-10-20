import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadLanguagePreference, readLanguagePreference, saveLanguagePreference } from './language-preference'
import { translate, translations, type Language, type TranslationKey } from './translations'

type TranslationValue<Section extends TranslationKey> = keyof (typeof translations.en)[Section] & string

type LanguageContextValue = {
  language: Language
  setLanguage: (language: Language) => void
  t: <Section extends TranslationKey>(section: Section, key: TranslationValue<Section>) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(readLanguagePreference)
  const [isPreferenceLoaded, setIsPreferenceLoaded] = useState(false)

  useEffect(() => {
    let active = true
    void loadLanguagePreference()
      .then((storedLanguage) => {
        if (active) setLanguage(storedLanguage)
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
    if (isPreferenceLoaded) void saveLanguagePreference(language)
    document.documentElement.lang = language
    document.title = translations[language].metadata.title
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', translations[language].metadata.description)
  }, [isPreferenceLoaded, language])

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t: (section, key) => translate(language, section, key),
    }),
    [language],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used within a LanguageProvider')
  return context
}
