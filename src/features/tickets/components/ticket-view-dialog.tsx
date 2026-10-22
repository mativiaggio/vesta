import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Paperclip,
  RefreshCw,
} from 'lucide-react'
import type { TicketAttachmentCursor } from '../../../../packages/tickets/src/attachment-contract'
import type { Ticket, TicketStatus } from '../../../../packages/tickets/src/contract'
import { Button } from '../../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { useLanguage } from '../../localization/language-context'
import type { Theme } from '../../preferences/theme-preference'
import type { TicketStorageMode } from '../application/use-ticket-state'
import type { TicketDetailPresentation } from '../application/ticket-view-preference'
import { useTicketAttachments } from '../application/use-ticket-attachments'
import { ticketAttachmentImageType } from '../data/ticket-attachment-preview'

type TicketViewDialogProps = {
  ticket: Ticket
  userId: string
  workspaceId: string
  storageMode: TicketStorageMode
  theme: Theme
  presentation: TicketDetailPresentation
  onPresentationChange: (presentation: TicketDetailPresentation) => void
  onOpenChange: (open: boolean) => void
}

type ImagePreviewState =
  | { attachmentId: string; attempt: number; state: 'failed' }
  | { attachmentId: string; attempt: number; state: 'ready'; url: string }

function statusKey(status: TicketStatus): `status_${TicketStatus}` {
  return `status_${status}`
}

function clientLabel(ticket: Ticket, internalLabel: string, unavailableLabel: string): string {
  if (ticket.clientId === null) return internalLabel
  return ticket.clientName ?? unavailableLabel
}

function formatFileSize(sizeBytes: number, formatter: Intl.NumberFormat): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let value = sizeBytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${formatter.format(value)} ${units[unitIndex]}`
}

export function TicketViewDialog({
  ticket,
  userId,
  workspaceId,
  storageMode,
  theme,
  presentation,
  onPresentationChange,
  onOpenChange,
}: TicketViewDialogProps) {
  const { language, t } = useLanguage()
  const [cursorHistory, setCursorHistory] = useState<(TicketAttachmentCursor | null)[]>([])
  const [currentCursor, setCurrentCursor] = useState<TicketAttachmentCursor | null>(null)
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null)
  const screenTitleRef = useRef<HTMLHeadingElement>(null)
  const [openFailed, setOpenFailed] = useState(false)
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null)
  const {
    attachments,
    nextCursor,
    isLoading: areAttachmentsLoading,
    operationFailed,
    loadPage,
    loadImagePreview,
    open,
    retry,
  } = useTicketAttachments(userId, workspaceId, ticket.id, storageMode)

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }),
    [language],
  )
  const hourFormatter = useMemo(
    () =>
      new Intl.NumberFormat(language, { style: 'unit', unit: 'hour', unitDisplay: 'narrow', maximumFractionDigits: 2 }),
    [language],
  )
  const numberFormatter = useMemo(() => new Intl.NumberFormat(language, { maximumFractionDigits: 1 }), [language])
  const imageCountFormatter = useMemo(() => new Intl.NumberFormat(language), [language])
  const images = useMemo(
    () => attachments.filter((attachment) => ticketAttachmentImageType(attachment) !== null),
    [attachments],
  )
  const otherAttachments = useMemo(
    () => attachments.filter((attachment) => ticketAttachmentImageType(attachment) === null),
    [attachments],
  )
  const selectedImage = images[selectedImageIndex] ?? null
  const selectedImageType = selectedImage ? ticketAttachmentImageType(selectedImage) : null
  const selectedPreview = imagePreview?.attachmentId === selectedImage?.id ? imagePreview : null
  const hasCurrentPreview = selectedPreview?.attempt === previewAttempt
  const previewLoading = Boolean(selectedImage && !hasCurrentPreview)
  const previewFailed = hasCurrentPreview && selectedPreview?.state === 'failed'
  const previewUrl = hasCurrentPreview && selectedPreview?.state === 'ready' ? selectedPreview.url : null

  useEffect(() => {
    if (!selectedImage) return
    const controller = new AbortController()
    let active = true
    let objectUrl: string | null = null
    void loadImagePreview(selectedImage, controller.signal)
      .then((blob) => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setImagePreview({ attachmentId: selectedImage.id, attempt: previewAttempt, state: 'ready', url: objectUrl })
      })
      .catch(() => {
        if (active) setImagePreview({ attachmentId: selectedImage.id, attempt: previewAttempt, state: 'failed' })
      })
    return () => {
      active = false
      controller.abort()
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [loadImagePreview, previewAttempt, selectedImage])

  useEffect(() => {
    if (presentation === 'fullscreen') screenTitleRef.current?.focus()
  }, [presentation, ticket.id])

  const attachmentPosition = t('tickets', 'attachmentImagePosition')
    .replace('{current}', imageCountFormatter.format(selectedImageIndex + 1))
    .replace('{total}', imageCountFormatter.format(images.length))

  function goToPreviousAttachmentPage() {
    if (cursorHistory.length === 0) return
    const previous = cursorHistory.at(-1) ?? null
    setCursorHistory((history) => history.slice(0, -1))
    setCurrentCursor(previous)
    setImagePreview(null)
    setPreviewAttempt(0)
    setSelectedImageIndex(0)
    void loadPage(previous)
  }

  function goToNextAttachmentPage() {
    if (!nextCursor) return
    setCursorHistory((history) => [...history, currentCursor])
    setCurrentCursor(nextCursor)
    setImagePreview(null)
    setPreviewAttempt(0)
    setSelectedImageIndex(0)
    void loadPage(nextCursor)
  }

  function selectImage(index: number) {
    setImagePreview(null)
    setPreviewAttempt(0)
    setSelectedImageIndex(index)
  }

  function formatDate(value: string | null): string {
    return value ? dateFormatter.format(new Date(value)) : '—'
  }

  async function openAttachment(attachmentId: string, action: () => Promise<void>) {
    setOpeningAttachmentId(attachmentId)
    setOpenFailed(false)
    try {
      await action()
    } catch {
      setOpenFailed(true)
    } finally {
      setOpeningAttachmentId(null)
    }
  }

  const presentationToggle = (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="ticket-view-presentation-toggle"
      aria-label={t('tickets', presentation === 'fullscreen' ? 'exitFullscreen' : 'enterFullscreen')}
      aria-pressed={presentation === 'fullscreen'}
      title={t('tickets', presentation === 'fullscreen' ? 'exitFullscreen' : 'enterFullscreen')}
      onClick={() => onPresentationChange(presentation === 'fullscreen' ? 'modal' : 'fullscreen')}
    >
      {presentation === 'fullscreen' ? (
        <Minimize2 size={15} aria-hidden="true" />
      ) : (
        <Maximize2 size={15} aria-hidden="true" />
      )}
    </Button>
  )

  const ticketViewContent = (
    <>
      {presentation === 'fullscreen' ? (
        <header className="ticket-view-header ticket-view-screen-header">
          <div className="ticket-view-screen-toolbar">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              <ArrowLeft size={14} aria-hidden="true" />
              {t('tickets', 'backToTickets')}
            </Button>
            <div className="ticket-view-screen-controls">
              <span className="ticket-kanban-ot-number ticket-view-ot">
                {t('tickets', 'otNumberShort')} {ticket.otNumber}
              </span>
              {presentationToggle}
            </div>
          </div>
          <h1 id="ticket-view-title" ref={screenTitleRef} tabIndex={-1}>
            {ticket.title}
          </h1>
          <p className="ticket-view-screen-subtitle">{t('tickets', 'ticketDetailsDescription')}</p>
        </header>
      ) : (
        <DialogHeader className="ticket-view-header">
          <div className="ticket-view-header-top">
            <div className="ticket-view-badges">
              <span className="ticket-kanban-ot-number ticket-view-ot">
                {t('tickets', 'otNumberShort')} {ticket.otNumber}
              </span>
            </div>
            {presentationToggle}
          </div>
          <DialogTitle>{ticket.title}</DialogTitle>
          <DialogDescription id="ticket-view-description">{t('tickets', 'ticketDetailsDescription')}</DialogDescription>
        </DialogHeader>
      )}

      <div className="ticket-view-content">
        <section className="ticket-view-section" aria-labelledby="ticket-view-description-title">
          <h3 id="ticket-view-description-title">{t('tickets', 'descriptionField')}</h3>
          <p className="ticket-view-description-text">
            {ticket.description || <span className="ticket-view-empty-value">{t('tickets', 'noDescription')}</span>}
          </p>
        </section>

        <dl className="ticket-view-details">
          <div>
            <dt>{t('tickets', 'status')}</dt>
            <dd>
              <span className={`ticket-status-badge is-${ticket.status}`}>
                {t('tickets', statusKey(ticket.status))}
              </span>
            </dd>
          </div>
          <div>
            <dt>{t('tickets', 'priority')}</dt>
            <dd>
              <span className={`ticket-priority-badge is-${ticket.priority}`}>{t('tickets', ticket.priority)}</span>
            </dd>
          </div>
          <div>
            <dt>{t('tickets', 'client')}</dt>
            <dd>{clientLabel(ticket, t('tickets', 'internal'), t('tickets', 'clientUnavailable'))}</dd>
          </div>
          <div>
            <dt>{t('tickets', 'estimatedHours')}</dt>
            <dd>{hourFormatter.format(ticket.estimatedHours)}</dd>
          </div>
          <div>
            <dt>{t('tickets', 'workedHours')}</dt>
            <dd>{hourFormatter.format(ticket.workedHours)}</dd>
          </div>
          <div>
            <dt>{t('tickets', 'codingFinishedAt')}</dt>
            <dd>{formatDate(ticket.codingFinishedAt)}</dd>
          </div>
          <div>
            <dt>{t('tickets', 'productionAt')}</dt>
            <dd>{formatDate(ticket.productionAt)}</dd>
          </div>
        </dl>

        <dl className="ticket-view-audit">
          <div>
            <dt>{t('tickets', 'createdAt')}</dt>
            <dd>
              <time dateTime={ticket.createdAt}>{formatDate(ticket.createdAt)}</time>
            </dd>
          </div>
          <div>
            <dt>{t('tickets', 'createdBy')}</dt>
            <dd>{ticket.createdByUserId === userId ? t('tickets', 'you') : ticket.createdByUserId}</dd>
          </div>
          <div>
            <dt>{t('tickets', 'updatedAt')}</dt>
            <dd>
              <time dateTime={ticket.updatedAt}>{formatDate(ticket.updatedAt)}</time>
            </dd>
          </div>
          <div>
            <dt>{t('tickets', 'updatedBy')}</dt>
            <dd>{ticket.updatedByUserId === userId ? t('tickets', 'you') : ticket.updatedByUserId}</dd>
          </div>
        </dl>

        <section className="ticket-view-attachments" aria-labelledby="ticket-view-attachments-title">
          <header className="ticket-view-attachments-heading">
            <h3 id="ticket-view-attachments-title">
              <Paperclip size={14} aria-hidden="true" />
              {t('tickets', 'attachments')}
            </h3>
            {areAttachmentsLoading && <span role="status">{t('tickets', 'attachmentLoading')}</span>}
          </header>

          {operationFailed && (
            <div className="ticket-view-attachment-error" role="alert">
              <span>{t('tickets', 'attachmentListFailed')}</span>
              <Button type="button" size="default" variant="ghost" onClick={() => void retry()}>
                <RefreshCw size={13} aria-hidden="true" />
                {t('tickets', 'tryAgain')}
              </Button>
            </div>
          )}
          {openFailed && (
            <p className="ticket-view-attachment-error" role="alert">
              {t('tickets', 'attachmentOpenFailed')}
            </p>
          )}

          {!operationFailed &&
            !areAttachmentsLoading &&
            (attachments.length === 0 ? (
              <p className="ticket-view-no-attachments">{t('tickets', 'noAttachments')}</p>
            ) : (
              <>
                {selectedImage && (
                  <div className="ticket-image-carousel" role="group" aria-label={t('tickets', 'imageAttachments')}>
                    <div className="ticket-image-frame">
                      {previewLoading && (
                        <span className="ticket-image-state" role="status">
                          <LoaderCircle size={17} className="ticket-attachment-spinner" aria-hidden="true" />
                          {t('tickets', 'attachmentPreviewLoading')}
                        </span>
                      )}
                      {previewFailed && (
                        <div className="ticket-image-state" role="alert">
                          {t('tickets', 'attachmentPreviewFailed')}
                          <Button
                            type="button"
                            size="default"
                            variant="ghost"
                            onClick={() => setPreviewAttempt((attempt) => attempt + 1)}
                          >
                            {t('tickets', 'tryAgain')}
                          </Button>
                        </div>
                      )}
                      {previewUrl && selectedImageType && (
                        <img
                          src={previewUrl}
                          alt={selectedImage.fileName}
                          onError={() => {
                            if (previewUrl) {
                              URL.revokeObjectURL(previewUrl)
                            }
                            setImagePreview({
                              attachmentId: selectedImage.id,
                              attempt: previewAttempt,
                              state: 'failed',
                            })
                          }}
                        />
                      )}
                    </div>
                    <div className="ticket-image-caption">
                      <span title={selectedImage.fileName}>{selectedImage.fileName}</span>
                      <span aria-live="polite">{attachmentPosition}</span>
                    </div>
                    <div className="ticket-image-controls">
                      <Button
                        type="button"
                        size="default"
                        variant="ghost"
                        aria-label={t('tickets', 'previousImage')}
                        disabled={images.length < 2 || areAttachmentsLoading}
                        onClick={() => selectImage((selectedImageIndex - 1 + images.length) % images.length)}
                      >
                        <ChevronLeft size={15} aria-hidden="true" />
                        {t('tickets', 'previousImage')}
                      </Button>
                      <Button
                        type="button"
                        size="default"
                        variant="ghost"
                        aria-label={t('tickets', 'nextImage')}
                        disabled={images.length < 2 || areAttachmentsLoading}
                        onClick={() => selectImage((selectedImageIndex + 1) % images.length)}
                      >
                        {t('tickets', 'nextImage')}
                        <ChevronRight size={15} aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="default"
                        variant="ghost"
                        disabled={openingAttachmentId === selectedImage.id}
                        onClick={() => void openAttachment(selectedImage.id, () => open(selectedImage))}
                      >
                        {openingAttachmentId === selectedImage.id ? (
                          <LoaderCircle size={14} className="ticket-attachment-spinner" aria-hidden="true" />
                        ) : (
                          <Download size={14} aria-hidden="true" />
                        )}
                        {t('tickets', 'openAttachment')}
                      </Button>
                    </div>
                  </div>
                )}

                {otherAttachments.length > 0 && (
                  <ul className="ticket-view-attachment-list">
                    {otherAttachments.map((attachment) => (
                      <li key={attachment.id}>
                        <div>
                          <span title={attachment.fileName}>{attachment.fileName}</span>
                          <small>{formatFileSize(attachment.sizeBytes, numberFormatter)}</small>
                        </div>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`${t('tickets', 'openAttachment')}: ${attachment.fileName}`}
                          title={t('tickets', 'openAttachment')}
                          disabled={openingAttachmentId === attachment.id}
                          onClick={() => void openAttachment(attachment.id, () => open(attachment))}
                        >
                          {openingAttachmentId === attachment.id ? (
                            <LoaderCircle size={14} className="ticket-attachment-spinner" aria-hidden="true" />
                          ) : (
                            <Download size={14} aria-hidden="true" />
                          )}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                {(cursorHistory.length > 0 || nextCursor !== null) && (
                  <nav className="ticket-attachment-pagination" aria-label={t('tickets', 'attachmentPagination')}>
                    <span>
                      {t('tickets', 'page')} {cursorHistory.length + 1}
                    </span>
                    <div>
                      <Button
                        type="button"
                        size="default"
                        variant="ghost"
                        className="ticket-attachment-pagination-button"
                        disabled={cursorHistory.length === 0 || areAttachmentsLoading}
                        onClick={goToPreviousAttachmentPage}
                      >
                        {t('tickets', 'previousPage')}
                      </Button>
                      <Button
                        type="button"
                        size="default"
                        variant="ghost"
                        className="ticket-attachment-pagination-button"
                        disabled={nextCursor === null || areAttachmentsLoading}
                        onClick={goToNextAttachmentPage}
                      >
                        {t('tickets', 'nextPage')}
                      </Button>
                    </div>
                  </nav>
                )}
              </>
            ))}
        </section>
      </div>

      {presentation === 'modal' && (
        <footer className="ticket-view-footer">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('tickets', 'closeView')}
          </Button>
        </footer>
      )}
    </>
  )

  if (presentation === 'fullscreen') {
    return (
      <section
        className={`ticket-view-screen${theme === 'dark' ? ' theme-dark' : ''}`}
        aria-labelledby="ticket-view-title"
      >
        {ticketViewContent}
      </section>
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className={`ticket-view-dialog${theme === 'dark' ? ' theme-dark' : ''}`}
        aria-describedby="ticket-view-description"
      >
        {ticketViewContent}
      </DialogContent>
    </Dialog>
  )
}
