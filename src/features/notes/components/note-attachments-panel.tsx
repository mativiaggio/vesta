import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileText,
  LoaderCircle,
  Paperclip,
  RotateCw,
  Trash2,
} from 'lucide-react'
import type { NoteAttachment, NoteAttachmentCursor } from '../../../../packages/notes/src/attachment-contract'
import { Button } from '../../../components/ui/button'
import { useLanguage } from '../../localization/language-context'
import { noteAttachmentImageType } from '../data/note-attachment-preview'
import { useNoteAttachments } from '../application/use-note-attachments'
import type { NoteStorageMode } from '../application/use-note-state'

type NoteAttachmentsPanelProps = {
  userId: string
  workspaceId: string
  noteId: string
  storageMode: NoteStorageMode
}

function formatSize(sizeBytes: number, formatter: Intl.NumberFormat): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let value = sizeBytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${formatter.format(value)} ${units[index]}`
}

export function NoteAttachmentsPanel({ userId, workspaceId, noteId, storageMode }: NoteAttachmentsPanelProps) {
  const { language, t } = useLanguage()
  const [cursor, setCursor] = useState<NoteAttachmentCursor | null>(null)
  const [cursorHistory, setCursorHistory] = useState<(NoteAttachmentCursor | null)[]>([])
  const [openFailure, setOpenFailure] = useState<'offline' | 'failed' | null>(null)
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null)
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const [imagePreview, setImagePreview] = useState<
    | { attachmentId: string; attempt: number; state: 'failed' }
    | { attachmentId: string; attempt: number; state: 'ready'; url: string }
    | null
  >(null)
  const fileInput = useRef<HTMLInputElement>(null)
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
    loadImagePreview,
    retry,
  } = useNoteAttachments(userId, workspaceId, noteId, storageMode)
  const previewAttachment = attachments.find((attachment) => attachment.id === previewAttachmentId) ?? null
  const selectedPreview = imagePreview?.attachmentId === previewAttachment?.id ? imagePreview : null
  const hasCurrentPreview = selectedPreview?.attempt === previewAttempt
  const previewLoading = Boolean(previewAttachment && !hasCurrentPreview)

  useEffect(() => {
    if (!previewAttachment) return
    const controller = new AbortController()
    let active = true
    let objectUrl: string | null = null
    void loadImagePreview(previewAttachment, controller.signal)
      .then((blob) => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setImagePreview({ attachmentId: previewAttachment.id, attempt: previewAttempt, state: 'ready', url: objectUrl })
      })
      .catch(() => {
        if (active) setImagePreview({ attachmentId: previewAttachment.id, attempt: previewAttempt, state: 'failed' })
      })
    return () => {
      active = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [loadImagePreview, previewAttachment, previewAttempt])
  const sizeFormatter = useMemo(() => new Intl.NumberFormat(language, { maximumFractionDigits: 1 }), [language])
  const hasPagination = cursorHistory.length > 0 || nextCursor !== null

  function goToNextPage() {
    if (!nextCursor) return
    setCursorHistory((history) => [...history, cursor])
    setCursor(nextCursor)
    void loadPage(nextCursor)
  }

  function goToPreviousPage() {
    if (cursorHistory.length === 0) return
    const previous = cursorHistory.at(-1) ?? null
    setCursorHistory((history) => history.slice(0, -1))
    setCursor(previous)
    void loadPage(previous)
  }

  async function openAttachment(attachment: NoteAttachment) {
    setOpenFailure(null)
    try {
      await open(attachment)
    } catch {
      setOpenFailure(navigator.onLine ? 'failed' : 'offline')
    }
  }

  return (
    <section className="note-attachments" aria-labelledby="note-attachments-title">
      <header className="note-attachments-heading">
        <h2 id="note-attachments-title">
          <Paperclip size={14} aria-hidden="true" />
          {t('notes', 'attachments')}
        </h2>
        <div>
          {storageMode !== 'local' && (
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              multiple
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const selected = Array.from(event.currentTarget.files ?? [])
                if (selected.length > 0) void addFiles(selected)
                event.currentTarget.value = ''
              }}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            className="note-add-attachments"
            disabled={isUploading}
            onClick={() => {
              if (storageMode === 'local') void addFiles([])
              else fileInput.current?.click()
            }}
          >
            {isUploading ? (
              <LoaderCircle className="loading-icon" size={14} aria-hidden="true" />
            ) : (
              <Paperclip size={14} aria-hidden="true" />
            )}
            {t('notes', isUploading ? 'attachmentUploading' : 'addAttachments')}
          </Button>
        </div>
      </header>

      {isSyncing && (
        <p className="note-attachment-status" role="status">
          {t('notes', 'attachmentSyncing')}
        </p>
      )}
      {hasPendingMutation && !isSyncing && (
        <p className="note-attachment-status" role="status">
          {t('notes', 'attachmentSavedLocally')}
        </p>
      )}
      {(hasFailedMutation || operationFailed) && (
        <div className="note-attachment-error" role="alert">
          <span>{operationFailed ? t('notes', 'attachmentOperationFailed') : t('notes', 'attachmentSyncFailed')}</span>
          {hasFailedMutation && storageMode !== 'local' && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t('notes', 'attachmentRetry')}
              onClick={() => void retry()}
            >
              <RotateCw size={13} aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
      {openFailure && (
        <p className="note-attachment-error" role="alert">
          {t('notes', openFailure === 'offline' ? 'attachmentUnavailableOffline' : 'attachmentOpenFailed')}
        </p>
      )}
      {isLoading ? (
        <p className="note-attachments-empty" role="status">
          {t('notes', 'attachmentLoading')}
        </p>
      ) : attachments.length === 0 ? (
        <p className="note-attachments-empty">{t('notes', 'noAttachments')}</p>
      ) : (
        <ul className="note-attachment-list">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <div className="note-attachment-row">
                <FileText size={15} aria-hidden="true" />
                <span className="note-attachment-file-name" title={attachment.fileName}>
                  {attachment.fileName}
                </span>
                <small>{formatSize(attachment.sizeBytes, sizeFormatter)}</small>
                <div className="note-attachment-actions">
                  {noteAttachmentImageType(attachment) && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`${t('notes', previewAttachmentId === attachment.id ? 'closePreview' : 'previewAttachment')}: ${attachment.fileName}`}
                      title={t('notes', previewAttachmentId === attachment.id ? 'closePreview' : 'previewAttachment')}
                      onClick={() => {
                        setPreviewAttempt(0)
                        setImagePreview(null)
                        setPreviewAttachmentId((current) => (current === attachment.id ? null : attachment.id))
                      }}
                    >
                      {previewAttachmentId === attachment.id ? (
                        <EyeOff size={13} aria-hidden="true" />
                      ) : (
                        <Eye size={13} aria-hidden="true" />
                      )}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`${t('notes', 'openAttachment')}: ${attachment.fileName}`}
                    title={t('notes', 'openAttachment')}
                    onClick={() => void openAttachment(attachment)}
                  >
                    <Download size={13} aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`${t('notes', 'removeAttachment')}: ${attachment.fileName}`}
                    title={t('notes', 'removeAttachment')}
                    onClick={() => void remove(attachment)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </Button>
                </div>
              </div>
              {previewAttachment?.id === attachment.id && (
                <figure className="note-attachment-preview">
                  {previewLoading && (
                    <span role="status">
                      <LoaderCircle className="loading-icon" size={14} aria-hidden="true" />
                      {t('notes', 'attachmentPreviewLoading')}
                    </span>
                  )}
                  {hasCurrentPreview && selectedPreview?.state === 'failed' && (
                    <span role="alert">
                      {t('notes', 'attachmentPreviewFailed')}
                      <Button type="button" variant="ghost" onClick={() => setPreviewAttempt((attempt) => attempt + 1)}>
                        {t('notes', 'tryAgain')}
                      </Button>
                    </span>
                  )}
                  {hasCurrentPreview && selectedPreview?.state === 'ready' && (
                    <img
                      src={selectedPreview.url}
                      alt={attachment.fileName}
                      onError={() => {
                        URL.revokeObjectURL(selectedPreview.url)
                        setImagePreview({ attachmentId: attachment.id, attempt: previewAttempt, state: 'failed' })
                      }}
                    />
                  )}
                </figure>
              )}
            </li>
          ))}
        </ul>
      )}
      {hasPagination && (
        <nav className="note-attachment-pagination" aria-label={t('notes', 'attachmentPagination')}>
          <span>
            {t('notes', 'page')} {cursorHistory.length + 1}
          </span>
          <div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t('notes', 'previousPage')}
              disabled={cursorHistory.length === 0 || isLoading}
              onClick={goToPreviousPage}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t('notes', 'nextPage')}
              disabled={!nextCursor || isLoading}
              onClick={goToNextPage}
            >
              <ChevronRight size={14} aria-hidden="true" />
            </Button>
          </div>
        </nav>
      )}
    </section>
  )
}
