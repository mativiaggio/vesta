import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Download, FolderOpen, LoaderCircle, Paperclip, RefreshCw, Trash2 } from 'lucide-react'
import type { TicketAttachmentCursor } from '../../../../packages/tickets/src/attachment-contract'
import { Button } from '../../../components/ui/button'
import { useLanguage } from '../../localization/language-context'
import type { TicketStorageMode } from '../application/use-ticket-state'
import { useTicketAttachments } from '../application/use-ticket-attachments'

type TicketAttachmentsPanelProps = {
  userId: string
  workspaceId: string
  ticketId: string
  storageMode: TicketStorageMode
}

export function TicketAttachmentsPanel({ userId, workspaceId, ticketId, storageMode }: TicketAttachmentsPanelProps) {
  const { language, t } = useLanguage()
  const fileInput = useRef<HTMLInputElement>(null)
  const [cursorHistory, setCursorHistory] = useState<(TicketAttachmentCursor | null)[]>([])
  const [currentCursor, setCurrentCursor] = useState<TicketAttachmentCursor | null>(null)
  const [openFailed, setOpenFailed] = useState(false)
  const {
    attachments,
    nextCursor,
    isLoading,
    isUploading,
    isSyncing,
    hasPendingMutation,
    hasFailedMutation,
    operationFailed,
    loadPage,
    addFiles,
    remove,
    open,
    openFolder,
    retry,
  } = useTicketAttachments(userId, workspaceId, ticketId, storageMode)

  const fileSizeFormatter = useMemo(() => new Intl.NumberFormat(language, { maximumFractionDigits: 1 }), [language])

  function onChooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (selected.length > 0) void addFiles(selected)
  }

  function goToPreviousPage() {
    if (cursorHistory.length === 0) return
    const previous = cursorHistory.at(-1) ?? null
    setCursorHistory((history) => history.slice(0, -1))
    setCurrentCursor(previous)
    void loadPage(previous)
  }

  function goToNextPage() {
    if (!nextCursor) return
    setCursorHistory((history) => [...history, currentCursor])
    setCurrentCursor(nextCursor)
    void loadPage(nextCursor)
  }

  function formatSize(sizeBytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
    let value = sizeBytes
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024
      unitIndex += 1
    }
    return `${fileSizeFormatter.format(value)} ${units[unitIndex]}`
  }

  return (
    <section className="ticket-attachments" aria-labelledby="ticket-attachments-title">
      <header className="ticket-attachments-heading">
        <h3 id="ticket-attachments-title">
          <Paperclip size={14} aria-hidden="true" />
          {t('tickets', 'attachments')}
        </h3>
        <div>
          {storageMode === 'local' && (
            <Button
              type="button"
              size="default"
              variant="ghost"
              className="ticket-attachment-toolbar-button"
              onClick={() => void openFolder().catch(() => setOpenFailed(true))}
            >
              <FolderOpen size={14} aria-hidden="true" />
              {t('tickets', 'openAttachmentsFolder')}
            </Button>
          )}
          {storageMode === 'server' && (
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              multiple
              aria-label={t('tickets', 'addAttachments')}
              onChange={onChooseFiles}
            />
          )}
          <Button
            type="button"
            size="default"
            variant="default"
            className="ticket-attachment-toolbar-button"
            disabled={isUploading}
            onClick={() => {
              if (storageMode === 'local') void addFiles()
              else fileInput.current?.click()
            }}
          >
            {isUploading ? (
              <LoaderCircle size={14} className="ticket-attachment-spinner" aria-hidden="true" />
            ) : (
              <Paperclip size={14} aria-hidden="true" />
            )}
            {t('tickets', isUploading ? 'attachmentUploading' : 'addAttachments')}
          </Button>
        </div>
      </header>

      {isSyncing && (
        <p className="ticket-attachment-status" role="status">
          {t('tickets', 'attachmentSyncing')}
        </p>
      )}
      {!isSyncing && storageMode === 'server' && hasPendingMutation && (
        <p className="ticket-attachment-status" role="status">
          {t('tickets', 'attachmentSavedLocally')}
        </p>
      )}
      {hasFailedMutation && (
        <div className="ticket-attachment-error" role="alert">
          <span>{t('tickets', 'attachmentSyncFailed')}</span>
          <Button
            type="button"
            size="default"
            variant="ghost"
            className="ticket-attachment-retry-button"
            onClick={() => void retry()}
          >
            <RefreshCw size={13} aria-hidden="true" />
            {t('tickets', 'attachmentRetry')}
          </Button>
        </div>
      )}
      {(operationFailed || openFailed) && (
        <p className="ticket-attachment-error" role="alert">
          {openFailed && storageMode === 'server' && !navigator.onLine
            ? t('tickets', 'attachmentUnavailableOffline')
            : openFailed
              ? t('tickets', 'attachmentOpenFailed')
              : t('tickets', 'attachmentOperationFailed')}
        </p>
      )}
      {isLoading ? (
        <p className="ticket-attachment-empty" role="status">
          {t('tickets', 'attachmentLoading')}
        </p>
      ) : attachments.length === 0 ? (
        <p className="ticket-attachment-empty">{t('tickets', 'noAttachments')}</p>
      ) : (
        <ul className="ticket-attachment-list">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <div className="ticket-attachment-file">
                <span className="ticket-attachment-file-name" title={attachment.fileName}>
                  {attachment.fileName}
                </span>
                <span className="ticket-attachment-file-size">{formatSize(attachment.sizeBytes)}</span>
              </div>
              <div className="ticket-attachment-actions">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`${t('tickets', 'openAttachment')}: ${attachment.fileName}`}
                  title={t('tickets', 'openAttachment')}
                  onClick={() => {
                    setOpenFailed(false)
                    void open(attachment).catch(() => setOpenFailed(true))
                  }}
                >
                  <Download size={14} aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`${t('tickets', 'removeAttachment')}: ${attachment.fileName}`}
                  title={t('tickets', 'removeAttachment')}
                  disabled={isUploading}
                  onClick={() => void remove(attachment)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              </div>
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
              disabled={cursorHistory.length === 0}
              onClick={goToPreviousPage}
            >
              {t('tickets', 'previousPage')}
            </Button>
            <Button
              type="button"
              size="default"
              variant="ghost"
              className="ticket-attachment-pagination-button"
              disabled={nextCursor === null}
              onClick={goToNextPage}
            >
              {t('tickets', 'nextPage')}
            </Button>
          </div>
        </nav>
      )}
    </section>
  )
}
