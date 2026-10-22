import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, LoaderCircle, RotateCw } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { useLanguage } from '../../localization/language-context'
import type { WorkspaceStorageMode } from '../application/use-workspace-state'
import { WorkspaceIconGlyph } from './workspace-icon'
import { workspaceAccentColors } from './workspace-theme'
import { useTicketOverview } from '../../tickets/application/use-ticket-overview'
import type { TicketActivity, TicketActivityKind } from '../../tickets/application/ticket-overview'
import { ticketStatuses, type TicketStatus } from '../../../../packages/tickets/src/contract'
import type { Workspace } from '../../../../packages/workspaces/src/contract'
import './workspace-overview.css'

type WorkspaceOverviewProps = {
  userId: string
  workspace: Workspace
  storageMode: WorkspaceStorageMode
}

type CalendarDay = {
  date: Date
  key: string
  isCurrentMonth: boolean
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateForKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year ?? 2000, (month ?? 1) - 1, day ?? 1)
}

function formatLocalDateKey(timestamp: string): string {
  return dateKey(new Date(timestamp))
}

function buildCalendarDays(month: Date, firstWeekday: number): CalendarDay[] {
  const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1)
  const leadingDays = (firstOfMonth.getDay() - firstWeekday + 7) % 7
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const totalCells = Math.ceil((leadingDays + daysInMonth) / 7) * 7
  const firstVisibleDay = new Date(month.getFullYear(), month.getMonth(), 1 - leadingDays)
  return Array.from({ length: totalCells }, (_, index) => {
    const date = new Date(firstVisibleDay.getFullYear(), firstVisibleDay.getMonth(), firstVisibleDay.getDate() + index)
    return { date, key: dateKey(date), isCurrentMonth: date.getMonth() === month.getMonth() }
  })
}

function activityLabel(kind: TicketActivityKind, t: ReturnType<typeof useLanguage>['t']): string {
  if (kind === 'created') return t('workspaceOverview', 'created')
  if (kind === 'codingFinished') return t('workspaceOverview', 'codingFinished')
  return t('workspaceOverview', 'production')
}

function activityTone(kind: TicketActivityKind): string {
  if (kind === 'created') return 'is-created'
  if (kind === 'codingFinished') return 'is-coded'
  return 'is-production'
}

function statusTranslationKey(status: TicketStatus): `status_${TicketStatus}` {
  return `status_${status}`
}

export function WorkspaceOverview({ userId, workspace, storageMode }: WorkspaceOverviewProps) {
  const { language, t } = useLanguage()
  const { overview, isLoading, isRefreshing, loadFailed, refreshFailed, retry } = useTicketOverview(
    userId,
    workspace.id,
    storageMode,
  )
  const today = new Date()
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(() => dateKey(today))
  const calendarDaysRef = useRef<HTMLDivElement>(null)
  const keyboardFocusDate = useRef<string | null>(null)

  const firstWeekday = language === 'es' ? 1 : 0
  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth, firstWeekday), [firstWeekday, visibleMonth])
  const monthTitle = useMemo(
    () => new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' }).format(visibleMonth),
    [language, visibleMonth],
  )
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    [language],
  )
  const pluralRules = useMemo(() => new Intl.PluralRules(language), [language])
  const numberFormatter = useMemo(() => new Intl.NumberFormat(language, { maximumFractionDigits: 2 }), [language])
  const dayNumberFormatter = useMemo(() => new Intl.NumberFormat(language, { useGrouping: false }), [language])
  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' }),
    [language],
  )
  const weekdayLongFormatter = useMemo(
    () => new Intl.DateTimeFormat(language, { weekday: 'long', timeZone: 'UTC' }),
    [language],
  )
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const weekday = (firstWeekday + index) % 7
        const date = new Date(Date.UTC(2023, 0, 1 + weekday))
        return { short: weekdayFormatter.format(date), long: weekdayLongFormatter.format(date) }
      }),
    [firstWeekday, weekdayFormatter, weekdayLongFormatter],
  )
  const activityByDate = useMemo(() => {
    const groups = new Map<string, TicketActivity[]>()
    for (const activity of overview?.activity ?? []) {
      const key = formatLocalDateKey(activity.occurredAt)
      const group = groups.get(key)
      if (group) group.push(activity)
      else groups.set(key, [activity])
    }
    for (const group of groups.values()) {
      group.sort(
        (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt) || left.otNumber - right.otNumber,
      )
    }
    return groups
  }, [overview?.activity])

  const selectedActivities = activityByDate.get(selectedDate) ?? []
  const maximumStatusCount = Math.max(1, ...ticketStatuses.map((status) => overview?.statusCounts[status] ?? 0))
  const maximumOpenHours = Math.max(overview?.estimatedOpenHours ?? 0, overview?.workedOpenHours ?? 0, 1)
  const estimatedWidth = overview ? `${(overview.estimatedOpenHours / maximumOpenHours) * 100}%` : '0%'
  const workedWidth = overview ? `${(overview.workedOpenHours / maximumOpenHours) * 100}%` : '0%'
  const currentReplicaIncomplete = storageMode === 'server' && overview !== null && !overview.hasCompleteReplica
  const showRefreshMessage = refreshFailed || currentReplicaIncomplete
  const refreshMessage = refreshFailed
    ? overview?.hasCompleteReplica
      ? t('workspaceOverview', 'refreshFailedComplete')
      : t('workspaceOverview', 'refreshFailedIncomplete')
    : t('workspaceOverview', 'offlineIncomplete')
  const workspaceStyle = { '--workspace-accent': workspaceAccentColors[workspace.accentColor] } as CSSProperties

  useEffect(() => {
    const focusDate = keyboardFocusDate.current
    if (!focusDate) return
    keyboardFocusDate.current = null
    calendarDaysRef.current?.querySelector<HTMLButtonElement>(`[data-date-key="${focusDate}"]`)?.focus()
  }, [selectedDate, visibleMonth])

  function changeMonth(offset: number) {
    const nextMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1)
    setVisibleMonth(nextMonth)
    setSelectedDate(dateKey(nextMonth))
  }

  function selectCalendarDay(day: CalendarDay) {
    if (!day.isCurrentMonth) setVisibleMonth(new Date(day.date.getFullYear(), day.date.getMonth(), 1))
    setSelectedDate(day.key)
  }

  function moveCalendarSelection(event: KeyboardEvent<HTMLButtonElement>, day: CalendarDay) {
    let nextDate: Date | null = null
    const dayOffset =
      event.key === 'ArrowLeft'
        ? -1
        : event.key === 'ArrowRight'
          ? 1
          : event.key === 'ArrowUp'
            ? -7
            : event.key === 'ArrowDown'
              ? 7
              : null

    if (dayOffset !== null) {
      nextDate = new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate() + dayOffset)
    } else if (event.key === 'Home') {
      const offset = (day.date.getDay() - firstWeekday + 7) % 7
      nextDate = new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate() - offset)
    } else if (event.key === 'End') {
      const offset = (day.date.getDay() - firstWeekday + 7) % 7
      nextDate = new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate() + 6 - offset)
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const monthOffset = event.key === 'PageUp' ? -1 : 1
      const targetMonth = new Date(day.date.getFullYear(), day.date.getMonth() + monthOffset, 1)
      const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate()
      nextDate = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(day.date.getDate(), lastDay))
    }

    if (!nextDate) return
    event.preventDefault()
    keyboardFocusDate.current = dateKey(nextDate)
    selectCalendarDay({
      date: nextDate,
      key: dateKey(nextDate),
      isCurrentMonth:
        nextDate.getMonth() === visibleMonth.getMonth() && nextDate.getFullYear() === visibleMonth.getFullYear(),
    })
  }

  return (
    <section className="workspace-overview" style={workspaceStyle} aria-labelledby="workspace-overview-title">
      <header className="workspace-overview-heading">
        <div>
          <h1 id="workspace-overview-title">{t('navigation', 'overview')}</h1>
          <span className="workspace-overview-workspace-name">{workspace.name}</span>
        </div>
        <span className="workspace-overview-mark" aria-hidden="true">
          <WorkspaceIconGlyph icon={workspace.icon} size={19} />
        </span>
      </header>

      {showRefreshMessage && (
        <p className="workspace-overview-notice" role="status">
          {refreshMessage}
        </p>
      )}

      {isLoading && !overview ? (
        <div className="workspace-overview-state" role="status">
          <LoaderCircle className="loading-icon" size={17} aria-hidden="true" />
          <span>{t('workspaceOverview', 'loading')}</span>
        </div>
      ) : loadFailed && !overview ? (
        <div className="workspace-overview-state is-error" role="alert">
          <div>
            <h2>{t('workspaceOverview', 'couldNotLoad')}</h2>
            <p>{t('workspaceOverview', 'loadHelp')}</p>
          </div>
          <Button variant="ghost" onClick={retry}>
            <RotateCw size={14} aria-hidden="true" />
            {t('workspaceOverview', 'tryAgain')}
          </Button>
        </div>
      ) : overview ? (
        <>
          <section className="workspace-overview-metrics" aria-label={t('workspaceOverview', 'metrics')}>
            <div className="workspace-overview-metric">
              <span>{t('workspaceOverview', 'openTickets')}</span>
              <strong>{numberFormatter.format(overview.openTicketCount)}</strong>
            </div>
            <div className="workspace-overview-metric">
              <span>{t('workspaceOverview', 'estimatedOpenHours')}</span>
              <strong>
                {numberFormatter.format(overview.estimatedOpenHours)} <small>{t('workspaceOverview', 'hours')}</small>
              </strong>
            </div>
            <div className="workspace-overview-metric">
              <span>{t('workspaceOverview', 'workedOpenHours')}</span>
              <strong>
                {numberFormatter.format(overview.workedOpenHours)} <small>{t('workspaceOverview', 'hours')}</small>
              </strong>
            </div>
            <div className="workspace-overview-metric">
              <span>{t('workspaceOverview', 'inProduction')}</span>
              <strong>{numberFormatter.format(overview.productionTicketCount)}</strong>
            </div>
          </section>

          {isRefreshing && (
            <div className="workspace-overview-refreshing" role="status">
              <LoaderCircle className="loading-icon" size={13} aria-hidden="true" />
              {t('workspaceOverview', 'refreshing')}
            </div>
          )}

          <div className="workspace-overview-content">
            <section className="workspace-overview-calendar" aria-labelledby="workspace-overview-calendar-title">
              <header className="workspace-overview-section-heading">
                <h2 id="workspace-overview-calendar-title">{t('workspaceOverview', 'calendar')}</h2>
                <div className="workspace-overview-month-control">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('workspaceOverview', 'previousMonth')}
                    onClick={() => changeMonth(-1)}
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </Button>
                  <span aria-live="polite">{monthTitle}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('workspaceOverview', 'nextMonth')}
                    onClick={() => changeMonth(1)}
                  >
                    <ChevronRight size={16} aria-hidden="true" />
                  </Button>
                </div>
              </header>

              <div className="workspace-overview-calendar-legend" aria-label={t('workspaceOverview', 'calendarLegend')}>
                {(['created', 'codingFinished', 'production'] as const).map((kind) => (
                  <span key={kind}>
                    <i className={`workspace-overview-dot ${activityTone(kind)}`} aria-hidden="true" />
                    {activityLabel(kind, t)}
                  </span>
                ))}
              </div>

              <div className="workspace-overview-calendar-body">
                <div className="workspace-overview-calendar-grid" aria-label={monthTitle}>
                  <div className="workspace-overview-weekdays" aria-hidden="true">
                    {weekdays.map((weekday, index) => (
                      <span key={`${weekday.long}-${index}`} title={weekday.long}>
                        {weekday.short}
                      </span>
                    ))}
                  </div>
                  <div className="workspace-overview-days" ref={calendarDaysRef}>
                    {calendarDays.map((day) => {
                      const dayActivities = activityByDate.get(day.key) ?? []
                      const kinds = new Set(dayActivities.map((activity) => activity.kind))
                      const isToday = day.key === dateKey(today)
                      const eventCountLabel = pluralRules.select(dayActivities.length) === 'one' ? 'event' : 'events'
                      const accessibleLabel = `${dateFormatter.format(day.date)}${dayActivities.length > 0 ? `, ${dayActivities.length} ${t('workspaceOverview', eventCountLabel)}` : ''}`
                      return (
                        <Button
                          key={day.key}
                          data-date-key={day.key}
                          type="button"
                          variant="ghost"
                          className={`workspace-overview-day${day.isCurrentMonth ? '' : ' is-outside'}${day.key === selectedDate ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
                          aria-label={accessibleLabel}
                          aria-pressed={day.key === selectedDate}
                          aria-current={isToday ? 'date' : undefined}
                          tabIndex={day.key === selectedDate ? 0 : -1}
                          onKeyDown={(event) => moveCalendarSelection(event, day)}
                          onClick={() => selectCalendarDay(day)}
                        >
                          <span className="workspace-overview-day-number">
                            {dayNumberFormatter.format(day.date.getDate())}
                          </span>
                          {dayActivities.length > 0 && (
                            <>
                              <span className="workspace-overview-day-count">
                                {dayNumberFormatter.format(dayActivities.length)}
                              </span>
                              <span className="workspace-overview-day-dots" aria-hidden="true">
                                {(['created', 'codingFinished', 'production'] as const)
                                  .filter((kind) => kinds.has(kind))
                                  .map((kind) => (
                                    <i key={kind} className={`workspace-overview-dot ${activityTone(kind)}`} />
                                  ))}
                              </span>
                            </>
                          )}
                        </Button>
                      )
                    })}
                  </div>
                </div>

                <aside className="workspace-overview-day-detail" aria-live="polite">
                  <h3>{dateFormatter.format(dateForKey(selectedDate))}</h3>
                  {selectedActivities.length === 0 ? (
                    <p className="workspace-overview-no-activity">{t('workspaceOverview', 'noActivity')}</p>
                  ) : (
                    <ul>
                      {selectedActivities.map((activity) => (
                        <li key={activity.key}>
                          <i className={`workspace-overview-dot ${activityTone(activity.kind)}`} aria-hidden="true" />
                          <div>
                            <span className="workspace-overview-event-type">{activityLabel(activity.kind, t)}</span>
                            <span className="workspace-overview-event-title" title={activity.title}>
                              <b>OT {activity.otNumber}</b> · {activity.title}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </aside>
              </div>
            </section>

            <div className="workspace-overview-charts">
              <section className="workspace-overview-chart" aria-labelledby="workspace-overview-hours-title">
                <header className="workspace-overview-chart-heading">
                  <h2 id="workspace-overview-hours-title">{t('workspaceOverview', 'hoursInProgress')}</h2>
                  <span>{t('workspaceOverview', 'openTicketsOnly')}</span>
                </header>
                <div className="workspace-overview-hours-chart">
                  <div className="workspace-overview-chart-label">
                    <span>{t('workspaceOverview', 'estimated')}</span>
                    <strong>
                      {numberFormatter.format(overview.estimatedOpenHours)} {t('workspaceOverview', 'hours')}
                    </strong>
                  </div>
                  <div className="workspace-overview-bar-track" aria-hidden="true">
                    <span className="is-estimated" style={{ width: estimatedWidth }} />
                  </div>
                  <div className="workspace-overview-chart-label">
                    <span>{t('workspaceOverview', 'worked')}</span>
                    <strong>
                      {numberFormatter.format(overview.workedOpenHours)} {t('workspaceOverview', 'hours')}
                    </strong>
                  </div>
                  <div className="workspace-overview-bar-track" aria-hidden="true">
                    <span className="is-worked" style={{ width: workedWidth }} />
                  </div>
                </div>
              </section>

              <section className="workspace-overview-chart" aria-labelledby="workspace-overview-status-title">
                <header className="workspace-overview-chart-heading">
                  <h2 id="workspace-overview-status-title">{t('workspaceOverview', 'ticketsByStatus')}</h2>
                  <span>{numberFormatter.format(overview.ticketCount)}</span>
                </header>
                {overview.ticketCount === 0 ? (
                  <p className="workspace-overview-no-tickets">{t('workspaceOverview', 'noTickets')}</p>
                ) : (
                  <ul className="workspace-overview-status-list">
                    {ticketStatuses.map((status) => {
                      const count = overview.statusCounts[status]
                      const width = count === 0 ? '0%' : `${Math.max(5, (count / maximumStatusCount) * 100)}%`
                      return (
                        <li key={status}>
                          <div className="workspace-overview-status-label">
                            <span>{t('tickets', statusTranslationKey(status))}</span>
                            <strong>{numberFormatter.format(count)}</strong>
                          </div>
                          <div className="workspace-overview-bar-track" aria-hidden="true">
                            <span style={{ width }} />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
