import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  Eye,
  GripVertical,
  LoaderCircle,
  List,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Ticket as TicketIcon,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select'
import { useLanguage } from '../../localization/language-context'
import type { Theme } from '../../preferences/theme-preference'
import {
  ticketPriorities,
  ticketStatuses,
  type Ticket,
  type TicketCursor,
  type TicketPriority,
  type TicketStatus,
} from '../../../../packages/tickets/src/contract'
import { useTicketState, type TicketStorageMode } from '../application/use-ticket-state'
import {
  loadTicketDetailPresentationPreference,
  loadTicketViewPreference,
  saveTicketDetailPresentationPreference,
  saveTicketViewPreference,
  type TicketDetailPresentation,
  type TicketView,
} from '../application/ticket-view-preference'
import { TicketDeleteDialog } from './ticket-delete-dialog'
import { TicketFormDialog } from './ticket-form-dialog'
import { TicketViewDialog } from './ticket-view-dialog'
import './tickets.css'

type TicketsExperienceProps = {
  userId: string
  workspaceId: string
  storageMode: TicketStorageMode
  theme: Theme
  onOpenNotes?: (ticket: Ticket) => void
}

function statusKey(status: TicketStatus): `status_${TicketStatus}` {
  return `status_${status}`
}

function clientLabel(ticket: Ticket, internalLabel: string, unavailableLabel: string): string {
  if (ticket.clientId === null) return internalLabel
  return ticket.clientName ?? unavailableLabel
}

function milestoneDate(ticket: Ticket): string | null {
  if (ticket.status === 'production') return ticket.productionAt
  if (ticket.status === 'delivered') return ticket.codingFinishedAt
  return null
}

type TicketKanbanCardProps = {
  ticket: Ticket
  dateFormatter: Intl.DateTimeFormat
  hourFormatter: Intl.NumberFormat
  onOpen: () => void
  onEdit: () => void
  onStatusChange: (status: TicketStatus) => void
}

function TicketKanbanCard({ ticket, dateFormatter, hourFormatter, onOpen, onEdit, onStatusChange }: TicketKanbanCardProps) {
  const { t } = useLanguage()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: ticket.id })
  const stageDate = milestoneDate(ticket)

  return (
    <article
      ref={setNodeRef}
      className={`ticket-kanban-card${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform) }}
    >
      <div className="ticket-kanban-card-heading">
        <div className="ticket-kanban-tags">
          <button
            type="button"
            className="ticket-kanban-drag-handle"
            {...attributes}
            {...listeners}
            aria-label={`${t('tickets', 'dragTicket')}: ${ticket.title}`}
            title={t('tickets', 'dragTicket')}
          >
            <GripVertical size={14} aria-hidden="true" />
          </button>
          <span className="ticket-kanban-ot-number">
            {t('tickets', 'otNumberShort')} {ticket.otNumber}
          </span>
          <span className={`ticket-priority-badge is-${ticket.priority}`}>{t('tickets', ticket.priority)}</span>
        </div>
        <div className="ticket-kanban-card-actions">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`${t('tickets', 'viewTicket')}: ${ticket.title}`}
            title={t('tickets', 'viewTicket')}
            onClick={onOpen}
          >
            <Eye size={13} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`${t('tickets', 'edit')} ${ticket.title}`}
            title={t('tickets', 'edit')}
            onClick={onEdit}
          >
            <Pencil size={13} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <h3>{ticket.title}</h3>
      <p className="ticket-kanban-client">
        {clientLabel(ticket, t('tickets', 'internal'), t('tickets', 'clientUnavailable'))}
      </p>
      {ticket.description && <p className="ticket-kanban-description">{ticket.description}</p>}
      <p className="ticket-kanban-hours">
        <span>
          {t('tickets', 'estimatedHours')}: {hourFormatter.format(ticket.estimatedHours)}
        </span>
        <span>
          {t('tickets', 'workedHours')}: {hourFormatter.format(ticket.workedHours)}
        </span>
      </p>
      {stageDate && (
        <time className="ticket-stage-date" dateTime={stageDate}>
          {dateFormatter.format(new Date(stageDate))}
        </time>
      )}
      <Select
        value={ticket.status}
        onValueChange={(value) => {
          if (ticketStatuses.includes(value as TicketStatus) && value !== ticket.status) {
            onStatusChange(value as TicketStatus)
          }
        }}
      >
        <SelectTrigger className="ticket-card-status-select" aria-label={`${t('tickets', 'moveTicketTo')}: ${ticket.title}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ticketStatuses.map((option) => (
            <SelectItem key={option} value={option}>
              {t('tickets', statusKey(option))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </article>
  )
}

type TicketKanbanLaneProps = {
  status: TicketStatus
  tickets: Ticket[]
  dateFormatter: Intl.DateTimeFormat
  hourFormatter: Intl.NumberFormat
  onOpenTicket: (ticket: Ticket) => void
  onEditTicket: (ticket: Ticket) => void
  onMoveTicket: (ticket: Ticket, status: TicketStatus) => void
}

function TicketKanbanLane({
  status,
  tickets,
  dateFormatter,
  hourFormatter,
  onOpenTicket,
  onEditTicket,
  onMoveTicket,
}: TicketKanbanLaneProps) {
  const { t } = useLanguage()
  const { isOver, setNodeRef } = useDroppable({ id: status })
  const laneTickets = tickets.filter((ticket) => ticket.status === status)

  return (
    <section
      ref={setNodeRef}
      className={`ticket-kanban-lane${isOver ? ' is-drop-target' : ''}`}
      aria-labelledby={`ticket-lane-${status}`}
    >
      <header className="ticket-kanban-lane-heading">
        <h2 id={`ticket-lane-${status}`}>{t('tickets', statusKey(status))}</h2>
        <span aria-label={`${laneTickets.length}`}>{laneTickets.length}</span>
      </header>
      {laneTickets.length === 0 ? (
        <p className="ticket-kanban-empty">{t('tickets', 'noTicketsInStage')}</p>
      ) : (
        <ul className="ticket-kanban-list">
          {laneTickets.map((ticket) => (
            <li key={ticket.id}>
              <TicketKanbanCard
                ticket={ticket}
                dateFormatter={dateFormatter}
                hourFormatter={hourFormatter}
                onOpen={() => onOpenTicket(ticket)}
                onEdit={() => onEditTicket(ticket)}
                onStatusChange={(nextStatus) => onMoveTicket(ticket, nextStatus)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function TicketsExperience({ userId, workspaceId, storageMode, theme, onOpenNotes }: TicketsExperienceProps) {
  const { language, t } = useLanguage()
  const [search, setSearch] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<TicketStatus | null>(null)
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | null>(null)
  const [cursor, setCursor] = useState<TicketCursor | null>(null)
  const [cursorHistory, setCursorHistory] = useState<(TicketCursor | null)[]>([])
  const [view, setView] = useState<TicketView>('table')
  const [ticketDetailPresentation, setTicketDetailPresentation] = useState<TicketDetailPresentation>('modal')
  const [isViewPreferenceLoaded, setIsViewPreferenceLoaded] = useState(false)
  const [isDetailPresentationPreferenceLoaded, setIsDetailPresentationPreferenceLoaded] = useState(false)
  const [viewPreferenceFailed, setViewPreferenceFailed] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null)
  const [viewingTicket, setViewingTicket] = useState<Ticket | null>(null)
  const [deletingTicket, setDeletingTicket] = useState<Ticket | null>(null)
  const detailPresentationPreferenceRef = useRef<Promise<TicketDetailPresentation> | null>(null)
  const ticketPageTitleRef = useRef<HTMLHeadingElement | null>(null)

  const filters = useMemo(
    () => ({ status: statusFilter, priority: priorityFilter, search: searchQuery }),
    [priorityFilter, searchQuery, statusFilter],
  )
  const {
    tickets,
    nextCursor,
    hasCompleteReplica,
    isLoading,
    loadFailed,
    isSaving,
    saveFailed,
    saveOtNumberConflict,
    hasOtNumberConflict,
    syncStatus,
    create,
    update,
    remove,
    retry,
    getNextOtNumber,
  } = useTicketState(userId, workspaceId, storageMode, cursor, filters)
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: 'medium' }), [language])
  const hourFormatter = useMemo(
    () =>
      new Intl.NumberFormat(language, {
        style: 'unit',
        unit: 'hour',
        unitDisplay: 'narrow',
        maximumFractionDigits: 2,
      }),
    [language],
  )
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  useEffect(() => {
    let active = true
    void loadTicketViewPreference()
      .then((storedView) => {
        if (active) setView(storedView)
      })
      .catch(() => {
        if (active) setViewPreferenceFailed(true)
      })
      .finally(() => {
        if (active) setIsViewPreferenceLoaded(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    const preference = loadTicketDetailPresentationPreference()
    detailPresentationPreferenceRef.current = preference
    void preference
      .then((storedPresentation) => {
        if (active) setTicketDetailPresentation(storedPresentation)
      })
      .catch(() => {
        if (active) setViewPreferenceFailed(true)
      })
      .finally(() => {
        if (active) setIsDetailPresentationPreferenceLoaded(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!isViewPreferenceLoaded) return
    void saveTicketViewPreference(view).catch(() => setViewPreferenceFailed(true))
  }, [isViewPreferenceLoaded, view])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchQuery(search.trim())
      setCursor(null)
      setCursorHistory([])
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [search])

  function openCreate() {
    setEditingTicket(null)
    setIsFormOpen(true)
  }

  function openEdit(ticket: Ticket) {
    setEditingTicket(ticket)
    setIsFormOpen(true)
  }

  async function openTicketView(ticket: Ticket) {
    if (!isDetailPresentationPreferenceLoaded && detailPresentationPreferenceRef.current) {
      try {
        setTicketDetailPresentation(await detailPresentationPreferenceRef.current)
      } catch {
        setViewPreferenceFailed(true)
      }
    }
    setViewingTicket(ticket)
  }

  function changeTicketDetailPresentation(presentation: TicketDetailPresentation) {
    setTicketDetailPresentation(presentation)
    setViewPreferenceFailed(false)
    void saveTicketDetailPresentationPreference(presentation).catch(() => setViewPreferenceFailed(true))
  }

  async function createTicket(values: Parameters<typeof create>[0], clientName: string | null) {
    const saved = await create(values, clientName)
    if (saved) {
      setSearch('')
      setSearchQuery('')
      setStatusFilter(null)
      setPriorityFilter(null)
      setCursor(null)
      setCursorHistory([])
    }
    return saved
  }

  async function updateTicket(ticketId: string, values: Parameters<typeof create>[0], clientName: string | null) {
    const current = tickets.find((item) => item.id === ticketId)
    if (!current) return false
    const changes = {
      ...(current.otNumber === values.otNumber ? {} : { otNumber: values.otNumber }),
      ...(current.clientId === values.clientId ? {} : { clientId: values.clientId }),
      ...(current.title === values.title ? {} : { title: values.title }),
      ...(current.description === values.description ? {} : { description: values.description }),
      ...(current.priority === values.priority ? {} : { priority: values.priority }),
      ...(current.status === values.status ? {} : { status: values.status }),
      ...(current.estimatedHours === values.estimatedHours ? {} : { estimatedHours: values.estimatedHours }),
      ...(current.workedHours === values.workedHours ? {} : { workedHours: values.workedHours }),
    }
    if (Object.keys(changes).length === 0) return true
    return update(ticketId, changes, clientName)
  }

  function goToPreviousPage() {
    if (cursorHistory.length === 0) return
    setCursor(cursorHistory.at(-1) ?? null)
    setCursorHistory((history) => history.slice(0, -1))
  }

  function goToNextPage() {
    if (!nextCursor) return
    setCursorHistory((history) => [...history, cursor])
    setCursor(nextCursor)
  }

  const pageNumber = cursorHistory.length + 1
  const hasPagination = cursorHistory.length > 0 || nextCursor !== null
  function handleKanbanDragEnd(event: DragEndEvent) {
    const ticketId = String(event.active.id)
    const status = event.over?.id
    const ticket = tickets.find((item) => item.id === ticketId)
    if (!ticket || typeof status !== 'string' || !ticketStatuses.includes(status as TicketStatus)) return
    if (ticket.status !== status) void update(ticket.id, { status: status as TicketStatus }, ticket.clientName)
  }
  const syncMessage =
    storageMode === 'local'
      ? null
      : syncStatus === 'syncing'
        ? t('tickets', 'syncing')
        : syncStatus === 'pending'
          ? t('tickets', 'savedLocally')
          : syncStatus === 'error'
            ? t('tickets', hasOtNumberConflict ? 'syncOtNumberConflict' : 'syncFailed')
            : null

  function renderTicketStatus(ticket: Ticket) {
    const stageDate = milestoneDate(ticket)
    return (
      <div className="ticket-status-cell">
        <span className={`ticket-status-badge is-${ticket.status}`}>{t('tickets', statusKey(ticket.status))}</span>
        {stageDate && (
          <time className="ticket-stage-date" dateTime={stageDate}>
            {dateFormatter.format(new Date(stageDate))}
          </time>
        )}
      </div>
    )
  }

  function closeTicketView() {
    setViewingTicket(null)
    if (ticketDetailPresentation === 'fullscreen') {
      window.requestAnimationFrame(() => ticketPageTitleRef.current?.focus())
    }
  }

  if (viewingTicket && ticketDetailPresentation === 'fullscreen') {
    return (
      <TicketViewDialog
        key={viewingTicket.id}
        ticket={viewingTicket}
        userId={userId}
        workspaceId={workspaceId}
        storageMode={storageMode}
        theme={theme}
        presentation={ticketDetailPresentation}
        onPresentationChange={changeTicketDetailPresentation}
        onOpenChange={(open) => {
          if (!open) closeTicketView()
        }}
      />
    )
  }

  return (
    <main className="ticket-page" aria-labelledby="tickets-title">
      <header className="ticket-page-heading">
        <div>
          <h1 id="tickets-title" ref={ticketPageTitleRef} tabIndex={-1}>
            {t('tickets', 'title')}
          </h1>
          <p>{t('tickets', 'description')}</p>
        </div>
        <Button type="button" onClick={openCreate}>
          <Plus size={15} aria-hidden="true" />
          {t('tickets', 'newTicket')}
        </Button>
      </header>

      {syncMessage && (
        <p className={`ticket-sync-message is-${syncStatus}`} role={syncStatus === 'error' ? 'alert' : 'status'}>
          {syncStatus === 'syncing' && <LoaderCircle size={14} className="ticket-sync-spinner" aria-hidden="true" />}
          {syncMessage}
        </p>
      )}
      {viewPreferenceFailed && (
        <p className="ticket-inline-error" role="status">
          {t('tickets', 'viewPreferenceFailed')}
        </p>
      )}
      {!isLoading && storageMode === 'server' && !hasCompleteReplica && (
        <p className="ticket-offline-note" role="status">
          {t('tickets', 'replicaIncomplete')}
        </p>
      )}
      {saveFailed && !isFormOpen && (
        <p className="ticket-inline-error" role="alert">
          {t('tickets', 'saveFailed')}
        </p>
      )}

      {loadFailed ? (
        <section className="ticket-message-state" role="alert">
          <h2>{t('tickets', 'couldNotLoad')}</h2>
          <p>{t('tickets', storageMode === 'local' ? 'localLoadHelp' : 'connectionHelp')}</p>
          <Button type="button" onClick={() => void retry()}>
            <RotateCw size={15} aria-hidden="true" />
            {t('tickets', 'tryAgain')}
          </Button>
        </section>
      ) : (
        <>
          <div className="ticket-toolbar">
            <label className="ticket-search">
              <Search size={15} aria-hidden="true" />
              <span className="visually-hidden">{t('tickets', 'searchLabel')}</span>
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder={t('tickets', 'searchPlaceholder')}
                autoComplete="off"
                maxLength={120}
              />
              {search.length > 0 && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="ticket-search-clear"
                  aria-label={t('tickets', 'clearSearch')}
                  title={t('tickets', 'clearSearch')}
                  onClick={() => setSearch('')}
                >
                  <X size={13} aria-hidden="true" />
                </Button>
              )}
            </label>
            <Select
              value={statusFilter ?? 'all'}
              onValueChange={(value) => {
                setStatusFilter(value === 'all' ? null : (value as TicketStatus))
                setCursor(null)
                setCursorHistory([])
              }}
            >
              <SelectTrigger className="ticket-filter-select" aria-label={t('tickets', 'statusFilter')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('tickets', 'allStatuses')}</SelectItem>
                {ticketStatuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t('tickets', statusKey(status))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={priorityFilter ?? 'all'}
              onValueChange={(value) => {
                setPriorityFilter(value === 'all' ? null : (value as TicketPriority))
                setCursor(null)
                setCursorHistory([])
              }}
            >
              <SelectTrigger
                className="ticket-filter-select ticket-priority-filter-select"
                aria-label={t('tickets', 'priorityFilter')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('tickets', 'allPriorities')}</SelectItem>
                {ticketPriorities.map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {t('tickets', priority)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ticket-view-switch" role="group" aria-label={t('tickets', 'viewMode')}>
              <Button
                type="button"
                variant={view === 'table' ? 'default' : 'ghost'}
                className="ticket-view-button"
                aria-pressed={view === 'table'}
                onClick={() => {
                  setViewPreferenceFailed(false)
                  setView('table')
                }}
              >
                <List size={14} aria-hidden="true" />
                {t('tickets', 'tableView')}
              </Button>
              <Button
                type="button"
                variant={view === 'kanban' ? 'default' : 'ghost'}
                className="ticket-view-button"
                aria-pressed={view === 'kanban'}
                onClick={() => {
                  setViewPreferenceFailed(false)
                  setView('kanban')
                }}
              >
                <Columns3 size={14} aria-hidden="true" />
                {t('tickets', 'kanbanView')}
              </Button>
            </div>
            {isLoading && (
              <span className="ticket-loading-label" role="status">
                {t('tickets', 'loading')}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="ticket-list-loading" role="status" aria-label={t('tickets', 'loading')}>
              <span />
              <span />
              <span />
            </div>
          ) : tickets.length === 0 ? (
            <section className="ticket-empty-state">
              <TicketIcon size={24} strokeWidth={1.5} aria-hidden="true" />
              <h2>
                {searchQuery || statusFilter || priorityFilter ? t('tickets', 'noMatches') : t('tickets', 'emptyTitle')}
              </h2>
              <p>
                {searchQuery || statusFilter || priorityFilter
                  ? t('tickets', 'noMatchesDescription')
                  : t('tickets', 'emptyDescription')}
              </p>
              {!searchQuery && !statusFilter && !priorityFilter && (
                <Button type="button" onClick={openCreate}>
                  <Plus size={15} aria-hidden="true" />
                  {t('tickets', 'newTicket')}
                </Button>
              )}
            </section>
          ) : view === 'table' ? (
            <div className="ticket-table-wrap">
              <table className="ticket-table">
                <thead>
                  <tr>
                    <th scope="col">{t('tickets', 'otNumber')}</th>
                    <th scope="col">{t('tickets', 'titleField')}</th>
                    <th scope="col">{t('tickets', 'client')}</th>
                    <th scope="col">{t('tickets', 'status')}</th>
                    <th scope="col">{t('tickets', 'priority')}</th>
                    <th scope="col">{t('tickets', 'hoursSummary')}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t('tickets', 'actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((ticket) => (
                    <tr key={ticket.id}>
                      <td className="ticket-ot-number-cell">
                        <span>
                          {t('tickets', 'otNumberShort')} {ticket.otNumber}
                        </span>
                      </td>
                      <td className="ticket-primary-cell">
                        <span className="ticket-row-title">{ticket.title}</span>
                        {ticket.description && <span className="ticket-row-description">{ticket.description}</span>}
                      </td>
                      <td className="ticket-client-cell">
                        {clientLabel(ticket, t('tickets', 'internal'), t('tickets', 'clientUnavailable'))}
                      </td>
                      <td>{renderTicketStatus(ticket)}</td>
                      <td>
                        <span className={`ticket-priority-badge is-${ticket.priority}`}>
                          {t('tickets', ticket.priority)}
                        </span>
                      </td>
                      <td className="ticket-hours-cell">
                        <span>{hourFormatter.format(ticket.estimatedHours)}</span>
                        <span aria-hidden="true"> / </span>
                        <span>{hourFormatter.format(ticket.workedHours)}</span>
                      </td>
                      <td className="ticket-actions-cell">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`${t('tickets', 'viewTicket')}: ${ticket.title}`}
                          title={t('tickets', 'viewTicket')}
                          onClick={() => void openTicketView(ticket)}
                        >
                          <Eye size={14} aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`${t('tickets', 'edit')} ${ticket.title}`}
                          title={t('tickets', 'edit')}
                          onClick={() => openEdit(ticket)}
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`${t('tickets', 'delete')} ${ticket.title}`}
                          title={t('tickets', 'delete')}
                          onClick={() => setDeletingTicket(ticket)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <DndContext
              sensors={dragSensors}
              onDragEnd={handleKanbanDragEnd}
              accessibility={{
                screenReaderInstructions: { draggable: t('tickets', 'dragInstructions') },
                announcements: {
                  onDragStart: ({ active }) => {
                    const ticket = tickets.find((item) => item.id === String(active.id))
                    return ticket ? `${t('tickets', 'ticketPickedUp')}: ${ticket.title}` : t('tickets', 'ticketPickedUp')
                  },
                  onDragOver: ({ active, over }) => {
                    const ticket = tickets.find((item) => item.id === String(active.id))
                    const status = typeof over?.id === 'string' && ticketStatuses.includes(over.id as TicketStatus)
                      ? (over.id as TicketStatus)
                      : null
                    if (!status) return t('tickets', 'noDropTarget')
                    return `${ticket?.title ?? ''} · ${t('tickets', 'ticketDroppedAt')} ${t('tickets', statusKey(status))}`
                  },
                  onDragEnd: ({ active, over }) => {
                    const ticket = tickets.find((item) => item.id === String(active.id))
                    const status = typeof over?.id === 'string' && ticketStatuses.includes(over.id as TicketStatus)
                      ? (over.id as TicketStatus)
                      : null
                    return status
                      ? `${ticket?.title ?? ''} · ${t('tickets', 'ticketDroppedAt')} ${t('tickets', statusKey(status))}`
                      : t('tickets', 'noDropTarget')
                  },
                  onDragCancel: () => t('tickets', 'ticketDropCanceled'),
                },
              }}
            >
              <div className="ticket-kanban" role="region" aria-label={t('tickets', 'kanbanView')}>
                {ticketStatuses.map((status) => (
                  <TicketKanbanLane
                    key={status}
                    status={status}
                    tickets={tickets}
                    dateFormatter={dateFormatter}
                    hourFormatter={hourFormatter}
                    onOpenTicket={(ticket) => void openTicketView(ticket)}
                    onEditTicket={openEdit}
                    onMoveTicket={(ticket, nextStatus) => {
                      void update(ticket.id, { status: nextStatus }, ticket.clientName)
                    }}
                  />
                ))}
              </div>
            </DndContext>
          )}

          {hasPagination && (
            <nav className="ticket-pagination" aria-label={t('tickets', 'pagination')}>
              <span>
                {t('tickets', 'page')} {pageNumber}
              </span>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  className="ticket-page-button"
                  disabled={cursorHistory.length === 0 || isLoading}
                  onClick={goToPreviousPage}
                >
                  <ChevronLeft size={14} aria-hidden="true" />
                  {t('tickets', 'previousPage')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="ticket-page-button"
                  disabled={nextCursor === null || isLoading}
                  onClick={goToNextPage}
                >
                  {t('tickets', 'nextPage')}
                  <ChevronRight size={14} aria-hidden="true" />
                </Button>
              </div>
            </nav>
          )}
        </>
      )}

      {isFormOpen && (
        <TicketFormDialog
          key={editingTicket?.id ?? 'new-ticket'}
          open={isFormOpen}
          userId={userId}
          workspaceId={workspaceId}
          storageMode={storageMode}
          ticket={editingTicket}
          theme={theme}
          isSaving={isSaving}
          saveFailed={saveFailed}
          saveOtNumberConflict={saveOtNumberConflict}
          getNextOtNumber={getNextOtNumber}
          onOpenChange={(open) => {
            setIsFormOpen(open)
            if (!open) setEditingTicket(null)
          }}
          onCreate={createTicket}
          onUpdate={updateTicket}
        />
      )}
      {viewingTicket && (
        <TicketViewDialog
          key={viewingTicket.id}
          ticket={viewingTicket}
          userId={userId}
          workspaceId={workspaceId}
          storageMode={storageMode}
          theme={theme}
          presentation={ticketDetailPresentation}
          onPresentationChange={changeTicketDetailPresentation}
          onOpenNotes={onOpenNotes}
          onOpenChange={(open) => {
            if (!open) closeTicketView()
          }}
        />
      )}
      <TicketDeleteDialog
        ticket={deletingTicket}
        theme={theme}
        isSaving={isSaving}
        saveFailed={saveFailed}
        onOpenChange={(open) => {
          if (!open) setDeletingTicket(null)
        }}
        onDelete={remove}
      />
    </main>
  )
}
