import type { Language } from '../localization/translations'
import { readPreference, writePreference } from './preference-store'

export type DateFormat = 'locale' | 'day-month-year' | 'month-day-year' | 'year-month-day'

const storageKey = 'vesta.date-format'

export function isDateFormat(value: string): value is DateFormat {
  return value === 'locale' || value === 'day-month-year' || value === 'month-day-year' || value === 'year-month-day'
}

export async function loadDateFormatPreference(): Promise<DateFormat> {
  const value = await readPreference(storageKey)
  return typeof value === 'string' && isDateFormat(value) ? value : 'locale'
}

export function saveDateFormatPreference(format: DateFormat): Promise<void> {
  return writePreference(storageKey, format)
}

export function formatDate(date: Date, language: Language, format: DateFormat): string {
  if (format === 'locale') return new Intl.DateTimeFormat(language, { dateStyle: 'short' }).format(date)

  const parts = new Intl.DateTimeFormat(language, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date)
  const part = (name: 'day' | 'month' | 'year') => parts.find(({ type }) => type === name)?.value ?? ''
  const day = part('day')
  const month = part('month')
  const year = part('year')

  switch (format) {
    case 'day-month-year':
      return `${day}/${month}/${year}`
    case 'month-day-year':
      return `${month}/${day}/${year}`
    case 'year-month-day':
      return `${year}-${month}-${day}`
  }
}
