import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select'
import { Textarea } from '../../../components/ui/textarea'
import { useLanguage } from '../../localization/language-context'
import type { ClientCursor } from '../../../../packages/clients/src/contract'
import { useClientState, type ClientStorageMode } from '../../clients/application/use-client-state'
import {
  createTicketSchema,
  ticketPriorities,
  ticketStatuses,
  type Ticket,
  type TicketPriority,
  type TicketStatus,
} from '../../../../packages/tickets/src/contract'
import type { Theme } from '../../preferences/theme-preference'
import { TicketAttachmentsPanel } from './ticket-attachments-panel'

type TicketValues = ReturnType<typeof createTicketSchema.parse>
type FieldError = 'otNumber' | 'title' | 'description' | 'estimatedHours' | 'workedHours' | null

type TicketFormDialogProps = {
  open: boolean
  userId: string
  workspaceId: string
  storageMode: ClientStorageMode
  ticket: Ticket | null
  theme: Theme
  isSaving: boolean
  saveFailed: boolean
  saveOtNumberConflict: boolean
  getNextOtNumber: () => Promise<number>
  onOpenChange: (open: boolean) => void
  onCreate: (values: TicketValues, clientName: string | null) => Promise<boolean>
  onUpdate: (ticketId: string, values: TicketValues, clientName: string | null) => Promise<boolean>
}

function statusKey(status: TicketStatus): `status_${TicketStatus}` {
  return `status_${status}`
}

export function TicketFormDialog({
  open,
  userId,
  workspaceId,
  storageMode,
  ticket,
  theme,
  isSaving,
  saveFailed,
  saveOtNumberConflict,
  getNextOtNumber,
  onOpenChange,
  onCreate,
  onUpdate,
}: TicketFormDialogProps) {
  const { language, t } = useLanguage()
  const [clientId, setClientId] = useState<string | null>(ticket?.clientId ?? null)
  const [clientCursor, setClientCursor] = useState<ClientCursor | null>(null)
  const [clientCursorHistory, setClientCursorHistory] = useState<(ClientCursor | null)[]>([])
  const {
    clients,
    nextCursor: nextClientCursor,
    isLoading: isLoadingClients,
  } = useClientState(userId, workspaceId, storageMode, clientCursor, '')
  const [otNumber, setOtNumber] = useState(String(ticket?.otNumber ?? 1))
  const otNumberEdited = useRef(false)
  const [title, setTitle] = useState(ticket?.title ?? '')
  const [description, setDescription] = useState(ticket?.description ?? '')
  const [priority, setPriority] = useState<TicketPriority>(ticket?.priority ?? 'medium')
  const [status, setStatus] = useState<TicketStatus>(ticket?.status ?? 'requested')
  const [estimatedHours, setEstimatedHours] = useState(String(ticket?.estimatedHours ?? 0))
  const [workedHours, setWorkedHours] = useState(String(ticket?.workedHours ?? 0))
  const [fieldError, setFieldError] = useState<FieldError>(null)

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }),
    [language],
  )
  const activeClients = clients.filter((client) => client.active)
  const selectedClient = activeClients.find((client) => client.id === clientId)
  const selectedClientIsUnavailable = Boolean(ticket?.clientId && ticket.clientId === clientId && !selectedClient)

  useEffect(() => {
    if (!open || ticket) return
    let active = true
    void getNextOtNumber()
      .then((suggestion) => {
        if (active && !otNumberEdited.current) setOtNumber(String(suggestion))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [getNextOtNumber, open, ticket])

  function goToPreviousClientPage() {
    if (clientCursorHistory.length === 0) return
    setClientCursor(clientCursorHistory.at(-1) ?? null)
    setClientCursorHistory((history) => history.slice(0, -1))
  }

  function goToNextClientPage() {
    if (!nextClientCursor) return
    setClientCursorHistory((history) => [...history, clientCursor])
    setClientCursor(nextClientCursor)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFieldError(null)
    const parsed = createTicketSchema.safeParse({
      otNumber: Number(otNumber),
      clientId,
      title,
      description,
      priority,
      status,
      estimatedHours: Number(estimatedHours),
      workedHours: Number(workedHours),
    })
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue?.path[0] === 'otNumber') setFieldError('otNumber')
      else if (issue?.path[0] === 'title') setFieldError('title')
      else if (issue?.path[0] === 'description') setFieldError('description')
      else if (issue?.path[0] === 'estimatedHours') setFieldError('estimatedHours')
      else if (issue?.path[0] === 'workedHours') setFieldError('workedHours')
      return
    }

    const saved = ticket
      ? await onUpdate(
          ticket.id,
          parsed.data,
          selectedClient?.name ?? (parsed.data.clientId === ticket.clientId ? ticket.clientName : null),
        )
      : await onCreate(parsed.data, selectedClient?.name ?? null)
    if (saved) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`ticket-dialog${theme === 'dark' ? ' theme-dark' : ''}`}
        aria-describedby="ticket-dialog-description"
      >
        <DialogHeader className="ticket-dialog-header">
          <DialogTitle>{t('tickets', ticket ? 'editTitle' : 'createTitle')}</DialogTitle>
          <DialogDescription id="ticket-dialog-description">
            {t('tickets', ticket ? 'editDescription' : 'createDescription')}
          </DialogDescription>
        </DialogHeader>
        <form className="ticket-dialog-form" onSubmit={(event) => void save(event)}>
          <div className="ticket-form-field">
            <label htmlFor="ticket-ot-number">{t('tickets', 'otNumber')}</label>
            <Input
              id="ticket-ot-number"
              type="number"
              inputMode="numeric"
              min="1"
              max="2147483647"
              step="1"
              value={otNumber}
              onChange={(event) => {
                otNumberEdited.current = true
                setOtNumber(event.currentTarget.value)
              }}
              autoFocus={!ticket}
              required
              aria-invalid={fieldError === 'otNumber'}
              aria-describedby={fieldError === 'otNumber' ? 'ticket-ot-number-error' : undefined}
            />
            {fieldError === 'otNumber' && (
              <span className="ticket-form-error" id="ticket-ot-number-error">
                {t('tickets', 'otNumberInvalid')}
              </span>
            )}
          </div>

          <div className="ticket-form-field">
            <label htmlFor="ticket-client-select">{t('tickets', 'client')}</label>
            <Select
              value={clientId ?? 'internal'}
              onValueChange={(value) => setClientId(value === 'internal' ? null : value)}
            >
              <SelectTrigger
                id="ticket-client-select"
                className="ticket-select-trigger"
                aria-label={t('tickets', 'client')}
              >
                <SelectValue placeholder={t('tickets', 'selectClient')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">{t('tickets', 'internal')}</SelectItem>
                {selectedClientIsUnavailable && ticket?.clientId && (
                  <SelectItem value={ticket.clientId}>
                    {ticket.clientName ?? t('tickets', 'activeClientNotFound')}
                  </SelectItem>
                )}
                {activeClients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.code} · {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ticket-client-pagination">
              {isLoadingClients && <span role="status">{t('clients', 'loading')}</span>}
              {!isLoadingClients && activeClients.length === 0 && <span>{t('tickets', 'noActiveClients')}</span>}
              <div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('clients', 'previousPage')}
                  title={t('clients', 'previousPage')}
                  disabled={clientCursorHistory.length === 0 || isLoadingClients}
                  onClick={goToPreviousClientPage}
                >
                  <ChevronLeft size={14} aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('clients', 'nextPage')}
                  title={t('clients', 'nextPage')}
                  disabled={nextClientCursor === null || isLoadingClients}
                  onClick={goToNextClientPage}
                >
                  <ChevronRight size={14} aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>

          <div className="ticket-form-field">
            <label htmlFor="ticket-title">{t('tickets', 'titleField')}</label>
            <Input
              id="ticket-title"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              autoComplete="off"
              maxLength={200}
              required
              aria-invalid={fieldError === 'title'}
              aria-describedby={fieldError === 'title' ? 'ticket-title-error' : undefined}
            />
            {fieldError === 'title' && (
              <span className="ticket-form-error" id="ticket-title-error">
                {t('tickets', 'titleRequired')}
              </span>
            )}
          </div>

          <div className="ticket-form-field">
            <label htmlFor="ticket-description">{t('tickets', 'descriptionField')}</label>
            <Textarea
              id="ticket-description"
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
              maxLength={20_000}
              rows={4}
              aria-invalid={fieldError === 'description'}
              aria-describedby={fieldError === 'description' ? 'ticket-description-error' : undefined}
            />
            {fieldError === 'description' && (
              <span className="ticket-form-error" id="ticket-description-error">
                {t('tickets', 'descriptionTooLong')}
              </span>
            )}
          </div>

          <div className="ticket-form-grid">
            <div className="ticket-form-field">
              <label htmlFor="ticket-priority">{t('tickets', 'priority')}</label>
              <Select value={priority} onValueChange={(value) => setPriority(value as TicketPriority)}>
                <SelectTrigger id="ticket-priority" className="ticket-select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ticketPriorities.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t('tickets', value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="ticket-form-field">
              <label htmlFor="ticket-status">{t('tickets', 'status')}</label>
              <Select value={status} onValueChange={(value) => setStatus(value as TicketStatus)}>
                <SelectTrigger id="ticket-status" className="ticket-select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ticketStatuses.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t('tickets', statusKey(value))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="ticket-form-field">
              <label htmlFor="ticket-estimated-hours">{t('tickets', 'estimatedHours')}</label>
              <Input
                id="ticket-estimated-hours"
                type="number"
                inputMode="decimal"
                min="0"
                max="999999.99"
                step="0.01"
                value={estimatedHours}
                onChange={(event) => setEstimatedHours(event.currentTarget.value)}
                required
                aria-invalid={fieldError === 'estimatedHours'}
                aria-describedby={fieldError === 'estimatedHours' ? 'ticket-estimated-hours-error' : undefined}
              />
              {fieldError === 'estimatedHours' && (
                <span className="ticket-form-error" id="ticket-estimated-hours-error">
                  {t('tickets', 'hoursInvalid')}
                </span>
              )}
            </div>
            <div className="ticket-form-field">
              <label htmlFor="ticket-worked-hours">{t('tickets', 'workedHours')}</label>
              <Input
                id="ticket-worked-hours"
                type="number"
                inputMode="decimal"
                min="0"
                max="999999.99"
                step="0.01"
                value={workedHours}
                onChange={(event) => setWorkedHours(event.currentTarget.value)}
                required
                aria-invalid={fieldError === 'workedHours'}
                aria-describedby={fieldError === 'workedHours' ? 'ticket-worked-hours-error' : undefined}
              />
              {fieldError === 'workedHours' && (
                <span className="ticket-form-error" id="ticket-worked-hours-error">
                  {t('tickets', 'hoursInvalid')}
                </span>
              )}
            </div>
          </div>

          <div className="ticket-milestones" aria-label={t('tickets', 'status')}>
            <div>
              <span>{t('tickets', 'codingFinishedAt')}</span>
              <time dateTime={ticket?.codingFinishedAt ?? undefined}>
                {ticket?.codingFinishedAt ? dateFormatter.format(new Date(ticket.codingFinishedAt)) : '—'}
              </time>
            </div>
            <div>
              <span>{t('tickets', 'productionAt')}</span>
              <time dateTime={ticket?.productionAt ?? undefined}>
                {ticket?.productionAt ? dateFormatter.format(new Date(ticket.productionAt)) : '—'}
              </time>
            </div>
          </div>

          {ticket && (
            <TicketAttachmentsPanel
              userId={userId}
              workspaceId={workspaceId}
              ticketId={ticket.id}
              storageMode={storageMode}
            />
          )}

          {ticket && (
            <p className="ticket-audit-note">
              {t('tickets', 'createdAt')}: {dateFormatter.format(new Date(ticket.createdAt))} ·{' '}
              {t('tickets', 'updatedAt')}: {dateFormatter.format(new Date(ticket.updatedAt))}
            </p>
          )}
          {saveFailed && (
            <p className="ticket-dialog-error" role="alert">
              {t('tickets', saveOtNumberConflict ? 'otNumberConflict' : 'saveFailed')}
            </p>
          )}
          <div className="ticket-dialog-footer">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
              {t('tickets', 'cancel')}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {t('tickets', isSaving ? 'saving' : 'save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
