import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  ArrowLeft,
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  LoaderCircle,
  Plus,
  Quote,
  RotateCw,
  StickyNote,
  Trash2,
  Underline,
  X,
} from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select'
import type { Note, RichTextDocument, RichTextNode } from '../../../../packages/notes/src/contract'
import { richTextDocumentSchema } from '../../../../packages/notes/src/contract'
import type { Ticket } from '../../../../packages/tickets/src/contract'
import { useLanguage } from '../../localization/language-context'
import type { Theme } from '../../preferences/theme-preference'
import { useTicketState } from '../../tickets/application/use-ticket-state'
import { useNoteState } from '../application/use-note-state'
import type { NoteConflictResolution, NoteStorageMode } from '../application/use-note-state'
import type { LocalNoteView } from '../data/note-local-store'
import { NoteAttachmentsPanel } from './note-attachments-panel'
import './notes.css'

type NotesExperienceProps = {
  userId: string
  workspaceId: string
  storageMode: NoteStorageMode
  theme: Theme
  initialTicket: Ticket | null
}

const emptyContent: RichTextDocument = { type: 'doc', content: [{ type: 'paragraph' }] }

function statusKey(status: Ticket['status']): `status_${Ticket['status']}` {
  return `status_${status}`
}

function summaryFromTicket(ticket: Ticket): Note['ticket'] {
  return {
    otNumber: ticket.otNumber,
    title: ticket.title,
    status: ticket.status,
    clientId: ticket.clientId,
    clientName: ticket.clientName,
  }
}

function noteText(node: RichTextNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return ' '
  const content = node.content?.map(noteText).join('') ?? ''
  return node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem' ? `${content} ` : content
}

function TicketPicker({
  userId,
  workspaceId,
  storageMode,
  selectedTicketId,
  selectedSummary,
  onSelect,
  disabled,
}: {
  userId: string
  workspaceId: string
  storageMode: NoteStorageMode
  selectedTicketId: string | null
  selectedSummary: Note['ticket'] | null
  onSelect: (ticketId: string, summary: Note['ticket']) => void
  disabled: boolean
}) {
  const { t, language } = useLanguage()
  const [cursor, setCursor] = useState<Parameters<typeof useTicketState>[3]>(null)
  const [cursorHistory, setCursorHistory] = useState<Parameters<typeof useTicketState>[3][]>([])
  const filters = useMemo(() => ({ status: null, priority: null, search: '' }), [])
  const { tickets, nextCursor, isLoading, loadFailed, retry } = useTicketState(
    userId,
    workspaceId,
    storageMode,
    cursor,
    filters,
  )
  const numberFormatter = useMemo(() => new Intl.NumberFormat(language), [language])

  const selectedVisible = tickets.find((ticket) => ticket.id === selectedTicketId)
  const selectedLabel = selectedVisible
    ? `${t('tickets', 'otNumberShort')} ${numberFormatter.format(selectedVisible.otNumber)} · ${selectedVisible.title}`
    : selectedSummary && selectedTicketId
      ? `${t('tickets', 'otNumberShort')} ${numberFormatter.format(selectedSummary.otNumber)} · ${selectedSummary.title}`
      : null
  const hasSelectedItem = Boolean(selectedTicketId && !selectedVisible && selectedSummary)

  function nextPage() {
    if (!nextCursor) return
    setCursorHistory((history) => [...history, cursor])
    setCursor(nextCursor)
  }

  function previousPage() {
    if (cursorHistory.length === 0) return
    setCursor(cursorHistory.at(-1) ?? null)
    setCursorHistory((history) => history.slice(0, -1))
  }

  return (
    <div className="note-ticket-picker">
      {loadFailed ? (
        <div className="note-ticket-picker-state" role="alert">
          <span>{t('notes', 'ticketLoadFailed')}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('notes', 'tryAgain')}
            onClick={() => void retry()}
          >
            <RotateCw size={14} aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <Select
          value={selectedTicketId ?? undefined}
          disabled={disabled || isLoading}
          onValueChange={(value) => {
            const ticket = tickets.find((item) => item.id === value)
            if (ticket) onSelect(ticket.id, summaryFromTicket(ticket))
          }}
        >
          <SelectTrigger className="note-ticket-select w-full min-w-0" aria-label={t('notes', 'ticketLabel')}>
            <SelectValue
              className="note-ticket-value"
              placeholder={isLoading ? t('notes', 'loadingTickets') : t('notes', 'chooseTicket')}
            />
          </SelectTrigger>
          <SelectContent className="note-ticket-options">
            {hasSelectedItem && selectedTicketId && selectedLabel && (
              <SelectItem value={selectedTicketId} title={selectedLabel}>
                {selectedLabel}
              </SelectItem>
            )}
            {tickets.map((ticket) => (
              <SelectItem
                key={ticket.id}
                value={ticket.id}
                title={`${t('tickets', 'otNumberShort')} ${numberFormatter.format(ticket.otNumber)} · ${ticket.title}`}
              >
                {t('tickets', 'otNumberShort')} {numberFormatter.format(ticket.otNumber)} · {ticket.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {(cursorHistory.length > 0 || nextCursor) && (
        <nav className="note-ticket-pagination" aria-label={t('notes', 'pagination')}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('notes', 'previousPage')}
            disabled={cursorHistory.length === 0 || isLoading}
            onClick={previousPage}
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </Button>
          <span>
            {t('notes', 'page')} {cursorHistory.length + 1}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('notes', 'nextPage')}
            disabled={!nextCursor || isLoading}
            onClick={nextPage}
          >
            <ChevronRight size={14} aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  )
}

function NoteEditor({
  userId,
  workspaceId,
  storageMode,
  note,
  initialTicket,
  isSaving,
  saveFailed,
  theme,
  onSave,
  onResolveConflict,
  onCancel,
  onRequestDelete,
}: {
  userId: string
  workspaceId: string
  storageMode: NoteStorageMode
  note: LocalNoteView | null
  initialTicket: Ticket | null
  isSaving: boolean
  saveFailed: boolean
  theme: Theme
  onSave: (
    note: Note | null,
    ticketId: string,
    title: string,
    content: RichTextDocument,
    ticket: Note['ticket'],
  ) => Promise<boolean>
  onResolveConflict: (note: Note, resolution: NoteConflictResolution) => Promise<boolean>
  onCancel: () => void
  onRequestDelete: (note: Note) => void
}) {
  const { t, language } = useLanguage()
  const hasConflict = note?.conflict !== undefined && note.conflict !== null
  const [title, setTitle] = useState(note?.title ?? '')
  const [selectedTicketId, setSelectedTicketId] = useState(note?.ticketId ?? initialTicket?.id ?? null)
  const [selectedTicket, setSelectedTicket] = useState<Note['ticket'] | null>(
    note?.ticket ?? (initialTicket ? summaryFromTicket(initialTicket) : null),
  )
  const [titleInvalid, setTitleInvalid] = useState(false)
  const [ticketInvalid, setTicketInvalid] = useState(false)
  const [contentInvalid, setContentInvalid] = useState(false)
  const [linkEditorOpen, setLinkEditorOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const contentRef = useRef<RichTextDocument>(note?.content ?? emptyContent)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
          protocols: ['http', 'https', 'mailto'],
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
        },
      }),
      Placeholder.configure({ placeholder: t('notes', 'contentPlaceholder') }),
    ],
    content: note?.content ?? emptyContent,
    immediatelyRender: false,
    onUpdate: ({ editor: currentEditor }) => {
      const parsed = richTextDocumentSchema.safeParse(currentEditor.getJSON())
      if (parsed.success) {
        contentRef.current = parsed.data
        setContentInvalid(false)
      } else setContentInvalid(true)
    },
  })
  useEffect(() => {
    editor?.setEditable(!isSaving && !hasConflict)
  }, [editor, hasConflict, isSaving])
  const formatModified = useMemo(
    () => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }),
    [language],
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanTitle = title.trim()
    const nextTitleInvalid = cleanTitle.length < 1 || cleanTitle.length > 160
    const nextTicketInvalid = selectedTicketId === null || selectedTicket === null
    const parsedContent = richTextDocumentSchema.safeParse(contentRef.current)
    setTitleInvalid(nextTitleInvalid)
    setTicketInvalid(nextTicketInvalid)
    setContentInvalid(!parsedContent.success)
    if (nextTitleInvalid || nextTicketInvalid || !parsedContent.success || !selectedTicketId || !selectedTicket) return
    if (await onSave(note, selectedTicketId, cleanTitle, parsedContent.data, selectedTicket)) onCancel()
  }

  function applyLink() {
    if (!editor) return
    const rawUrl = linkUrl.trim()
    let safeUrl: string | null = null
    try {
      const parsed = new URL(rawUrl)
      if (['https:', 'http:', 'mailto:'].includes(parsed.protocol)) safeUrl = parsed.toString()
    } catch {
      safeUrl = null
    }
    if (!safeUrl) return
    editor.chain().focus().extendMarkRange('link').setLink({ href: safeUrl, target: '_blank' }).run()
    setLinkUrl('')
    setLinkEditorOpen(false)
  }

  const editorButton = (label: string, active: boolean, onClick: () => void, icon: ReactNode) => (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`note-editor-tool${active ? ' is-active' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={!editor || isSaving || hasConflict}
      onClick={onClick}
    >
      {icon}
    </Button>
  )

  return (
    <main
      className={`notes-page note-editor-page${theme === 'dark' ? ' theme-dark' : ''}`}
      aria-labelledby="note-editor-title"
    >
      <header className="notes-editor-heading">
        <Button type="button" variant="ghost" className="notes-back-button" onClick={onCancel}>
          <ArrowLeft size={14} aria-hidden="true" />
          {t('notes', 'back')}
        </Button>
        <div className="notes-editor-heading-row">
          <div>
            <h1 id="note-editor-title">{t('notes', note ? 'editorEditTitle' : 'editorNewTitle')}</h1>
            <p>{t('notes', 'editorDescription')}</p>
          </div>
          <div className="notes-editor-actions">
            {note && (
              <Button
                type="button"
                variant="ghost"
                className="note-delete-trigger"
                disabled={isSaving || hasConflict}
                onClick={() => onRequestDelete(note)}
              >
                <Trash2 size={14} aria-hidden="true" />
                {t('notes', 'delete')}
              </Button>
            )}
            <Button type="submit" form="note-editor-form" disabled={isSaving || hasConflict || !editor}>
              {isSaving ? (
                <LoaderCircle className="loading-icon" size={15} aria-hidden="true" />
              ) : (
                <Check size={15} aria-hidden="true" />
              )}
              {t('notes', isSaving ? 'saving' : 'save')}
            </Button>
          </div>
        </div>
      </header>

      <form id="note-editor-form" className="note-editor-layout" onSubmit={(event) => void handleSubmit(event)}>
        {saveFailed && (
          <p className="notes-inline-error" role="alert">
            {t('notes', 'saveFailed')}
          </p>
        )}
        {note?.conflict && (
          <section className="note-conflict-notice" role="alert" aria-labelledby="note-conflict-title">
            <h2 id="note-conflict-title">{t('notes', 'conflictTitle')}</h2>
            <p>
              {t(
                'notes',
                note.conflict.kind === 'note.delete' ? 'deleteConflictDescription' : 'updateConflictDescription',
              )}
            </p>
            <div className="note-conflict-latest">
              <span>{t('notes', 'latestVersion')}</span>
              <strong>{note.conflict.remote.title}</strong>
              <p>{noteText(note.conflict.remote.content).trim().slice(0, 360)}</p>
            </div>
            <div className="note-conflict-actions">
              {note.conflict.kind === 'note.update' ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isSaving}
                    onClick={() => void onResolveConflict(note, 'remote')}
                  >
                    {t('notes', 'useLatestCopy')}
                  </Button>
                  <Button type="button" disabled={isSaving} onClick={() => void onResolveConflict(note, 'local')}>
                    {t('notes', 'keepMyChanges')}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isSaving}
                    onClick={() => void onResolveConflict(note, 'remote')}
                  >
                    {t('notes', 'keepNote')}
                  </Button>
                  <Button
                    type="button"
                    className="note-delete-confirm"
                    disabled={isSaving}
                    onClick={() => void onResolveConflict(note, 'delete-latest')}
                  >
                    {t('notes', 'deleteLatestCopy')}
                  </Button>
                </>
              )}
            </div>
          </section>
        )}
        <div className="note-editor-fields">
          <label className="note-field">
            <span>{t('notes', 'titleLabel')}</span>
            <Input
              value={title}
              disabled={isSaving || hasConflict}
              autoFocus
              maxLength={160}
              aria-invalid={titleInvalid}
              aria-describedby={titleInvalid ? 'note-title-error' : undefined}
              placeholder={t('notes', 'titlePlaceholder')}
              onChange={(event) => {
                setTitle(event.currentTarget.value)
                setTitleInvalid(false)
              }}
            />
            {titleInvalid && (
              <small className="note-field-error" id="note-title-error">
                {t('notes', 'titleRequired')}
              </small>
            )}
          </label>
          <div className="note-field">
            <span>{t('notes', 'ticketLabel')}</span>
            <TicketPicker
              userId={userId}
              workspaceId={workspaceId}
              storageMode={storageMode}
              selectedTicketId={selectedTicketId}
              selectedSummary={selectedTicket}
              disabled={isSaving || hasConflict}
              onSelect={(ticketId, summary) => {
                setSelectedTicketId(ticketId)
                setSelectedTicket(summary)
                setTicketInvalid(false)
              }}
            />
            {ticketInvalid && <small className="note-field-error">{t('notes', 'ticketRequired')}</small>}
          </div>
        </div>

        <section className="note-editor-surface" aria-labelledby="note-content-label">
          <h2 className="visually-hidden" id="note-content-label">
            {t('notes', 'editorLabel')}
          </h2>
          <div className="note-editor-toolbar" role="toolbar" aria-label={t('notes', 'editorLabel')}>
            {editorButton(
              t('notes', 'bold'),
              editor?.isActive('bold') ?? false,
              () => editor?.chain().focus().toggleBold().run(),
              <Bold size={15} aria-hidden="true" />,
            )}
            {editorButton(
              t('notes', 'italic'),
              editor?.isActive('italic') ?? false,
              () => editor?.chain().focus().toggleItalic().run(),
              <Italic size={15} aria-hidden="true" />,
            )}
            {editorButton(
              t('notes', 'underline'),
              editor?.isActive('underline') ?? false,
              () => editor?.chain().focus().toggleUnderline().run(),
              <Underline size={15} aria-hidden="true" />,
            )}
            <span className="note-toolbar-divider" aria-hidden="true" />
            {editorButton(
              t('notes', 'headingOne'),
              editor?.isActive('heading', { level: 1 }) ?? false,
              () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
              <Heading1 size={15} aria-hidden="true" />,
            )}
            {editorButton(
              t('notes', 'headingTwo'),
              editor?.isActive('heading', { level: 2 }) ?? false,
              () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
              <Heading2 size={15} aria-hidden="true" />,
            )}
            {editorButton(
              t('notes', 'bulletList'),
              editor?.isActive('bulletList') ?? false,
              () => editor?.chain().focus().toggleBulletList().run(),
              <List size={15} aria-hidden="true" />,
            )}
            {editorButton(
              t('notes', 'orderedList'),
              editor?.isActive('orderedList') ?? false,
              () => editor?.chain().focus().toggleOrderedList().run(),
              <ListOrdered size={15} aria-hidden="true" />,
            )}
            {editorButton(
              t('notes', 'quote'),
              editor?.isActive('blockquote') ?? false,
              () => editor?.chain().focus().toggleBlockquote().run(),
              <Quote size={15} aria-hidden="true" />,
            )}
            {editorButton(
              t('notes', 'code'),
              editor?.isActive('codeBlock') ?? false,
              () => editor?.chain().focus().toggleCodeBlock().run(),
              <Code2 size={15} aria-hidden="true" />,
            )}
            {editorButton(
              t('notes', 'link'),
              editor?.isActive('link') ?? false,
              () => setLinkEditorOpen((open) => !open),
              <Link2 size={15} aria-hidden="true" />,
            )}
          </div>
          {linkEditorOpen && (
            <div className="note-link-editor">
              <Input
                type="url"
                autoFocus
                value={linkUrl}
                aria-label={t('notes', 'link')}
                placeholder={t('notes', 'enterLink')}
                onChange={(event) => setLinkUrl(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    applyLink()
                  }
                  if (event.key === 'Escape') setLinkEditorOpen(false)
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={isSaving || hasConflict}
                aria-label={t('notes', 'saveLink')}
                onClick={applyLink}
              >
                <Check size={14} aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={isSaving}
                aria-label={t('notes', 'cancelLink')}
                onClick={() => setLinkEditorOpen(false)}
              >
                <X size={14} aria-hidden="true" />
              </Button>
            </div>
          )}
          <div className="note-editor-content" aria-label={t('notes', 'editorLabel')}>
            {editor ? <EditorContent editor={editor} /> : <p role="status">{t('notes', 'loadingEditor')}</p>}
          </div>
          {contentInvalid && (
            <p className="note-field-error" role="alert">
              {t('notes', 'saveFailed')}
            </p>
          )}
        </section>

        {note && (
          <div className="note-editor-lower">
            <NoteAttachmentsPanel
              userId={userId}
              workspaceId={workspaceId}
              noteId={note.id}
              storageMode={storageMode}
            />
            <p className="note-updated-at">
              {t('notes', 'updatedAt')}{' '}
              <time dateTime={note.updatedAt}>{formatModified.format(new Date(note.updatedAt))}</time>
            </p>
          </div>
        )}

        <footer className="note-editor-footer">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isSaving}>
            {t('notes', 'cancel')}
          </Button>
          <Button type="submit" disabled={isSaving || hasConflict || !editor}>
            {isSaving ? <LoaderCircle className="loading-icon" size={15} aria-hidden="true" /> : null}
            {t('notes', isSaving ? 'saving' : 'save')}
          </Button>
        </footer>
      </form>
    </main>
  )
}

function NoteDeleteDialog({
  note,
  theme,
  isSaving,
  saveFailed,
  onOpenChange,
  onDelete,
}: {
  note: Note | null
  theme: Theme
  isSaving: boolean
  saveFailed: boolean
  onOpenChange: (open: boolean) => void
  onDelete: (note: Note) => Promise<boolean>
}) {
  const { t } = useLanguage()
  return (
    <Dialog open={note !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className={`note-delete-dialog${theme === 'dark' ? ' theme-dark' : ''}`}
        aria-describedby="note-delete-description"
      >
        <DialogHeader>
          <DialogTitle>{t('notes', 'confirmDelete')}</DialogTitle>
          <DialogDescription id="note-delete-description">{t('notes', 'deleteDescription')}</DialogDescription>
        </DialogHeader>
        {saveFailed && (
          <p className="notes-inline-error" role="alert">
            {t('notes', 'deleteFailed')}
          </p>
        )}
        <div className="note-delete-actions">
          <Button type="button" variant="ghost" disabled={isSaving} onClick={() => onOpenChange(false)}>
            {t('notes', 'cancel')}
          </Button>
          <Button
            type="button"
            className="note-delete-confirm"
            disabled={isSaving || note === null}
            onClick={() => {
              if (note) void onDelete(note)
            }}
          >
            {isSaving ? (
              <LoaderCircle className="loading-icon" size={14} aria-hidden="true" />
            ) : (
              <Trash2 size={14} aria-hidden="true" />
            )}
            {t('notes', isSaving ? 'deleting' : 'confirmDeleteAction')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function NotesExperience({ userId, workspaceId, storageMode, theme, initialTicket }: NotesExperienceProps) {
  const { language, t } = useLanguage()
  const [filteredTicket, setFilteredTicket] = useState<Ticket | null>(initialTicket)
  const [cursor, setCursor] = useState<Parameters<typeof useNoteState>[3]>(null)
  const [cursorHistory, setCursorHistory] = useState<Parameters<typeof useNoteState>[3][]>([])
  const [editingNote, setEditingNote] = useState<LocalNoteView | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [deletingNote, setDeletingNote] = useState<Note | null>(null)
  const filters = useMemo(() => ({ ticketId: filteredTicket?.id ?? null }), [filteredTicket?.id])
  const {
    notes,
    nextCursor,
    isLoading,
    loadFailed,
    isSaving,
    saveFailed,
    syncStatus,
    create,
    update,
    remove,
    retry,
    resolveConflict,
  } = useNoteState(userId, workspaceId, storageMode, cursor, filters)
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: 'medium' }), [language])
  const numberFormatter = useMemo(() => new Intl.NumberFormat(language), [language])
  const pageNumber = cursorHistory.length + 1
  const hasPagination = cursorHistory.length > 0 || nextCursor !== null

  const noteForEditor = editingNote
    ? (notes.find((note) => note.id === editingNote.id && note.conflict) ?? editingNote)
    : null

  function nextPage() {
    if (!nextCursor) return
    setCursorHistory((history) => [...history, cursor])
    setCursor(nextCursor)
  }

  function previousPage() {
    if (cursorHistory.length === 0) return
    setCursor(cursorHistory.at(-1) ?? null)
    setCursorHistory((history) => history.slice(0, -1))
  }

  async function saveNote(
    note: Note | null,
    ticketId: string,
    title: string,
    content: RichTextDocument,
    ticket: Note['ticket'],
  ): Promise<boolean> {
    if (note) return update(note, { ticketId, title, content }, ticket)
    return (await create({ ticketId, title, content }, ticket)) !== null
  }

  async function deleteNote(note: Note): Promise<boolean> {
    const deleted = await remove(note)
    if (deleted) {
      setDeletingNote(null)
      setIsEditorOpen(false)
      setEditingNote(null)
    }
    return deleted
  }

  async function resolveNoteConflict(note: Note, resolution: NoteConflictResolution): Promise<boolean> {
    const resolved = await resolveConflict(note, resolution)
    if (resolved) {
      setIsEditorOpen(false)
      setEditingNote(null)
    }
    return resolved
  }

  if (isEditorOpen) {
    return (
      <>
        <NoteEditor
          key={editingNote?.id ?? `new-${filteredTicket?.id ?? 'note'}`}
          userId={userId}
          workspaceId={workspaceId}
          storageMode={storageMode}
          note={noteForEditor}
          initialTicket={filteredTicket}
          isSaving={isSaving}
          saveFailed={saveFailed}
          theme={theme}
          onSave={saveNote}
          onResolveConflict={resolveNoteConflict}
          onCancel={() => {
            setIsEditorOpen(false)
            setEditingNote(null)
          }}
          onRequestDelete={setDeletingNote}
        />
        <NoteDeleteDialog
          note={deletingNote}
          theme={theme}
          isSaving={isSaving}
          saveFailed={saveFailed}
          onOpenChange={(open) => {
            if (!open) setDeletingNote(null)
          }}
          onDelete={deleteNote}
        />
      </>
    )
  }

  const syncMessage =
    storageMode === 'local'
      ? null
      : syncStatus === 'syncing'
        ? t('notes', 'syncing')
        : syncStatus === 'pending'
          ? t('notes', 'savedLocally')
          : syncStatus === 'error'
            ? t('notes', 'syncFailed')
            : null

  return (
    <main className="notes-page" aria-labelledby="notes-title">
      <header className="notes-page-heading">
        <div className="notes-heading-copy">
          {filteredTicket ? (
            <Button
              type="button"
              variant="ghost"
              className="notes-filter-back"
              onClick={() => {
                setFilteredTicket(null)
                setCursor(null)
                setCursorHistory([])
              }}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              {t('notes', 'allNotes')}
            </Button>
          ) : null}
          <h1 id="notes-title">{filteredTicket ? t('notes', 'notesForTicket') : t('notes', 'title')}</h1>
          <p>
            {filteredTicket
              ? `${t('tickets', 'otNumberShort')} ${numberFormatter.format(filteredTicket.otNumber)} · ${filteredTicket.title}`
              : t('notes', 'description')}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setEditingNote(null)
            setIsEditorOpen(true)
          }}
        >
          <Plus size={15} aria-hidden="true" />
          {t('notes', 'newNote')}
        </Button>
      </header>

      {syncMessage && (
        <p className={`notes-sync-message is-${syncStatus}`} role={syncStatus === 'error' ? 'alert' : 'status'}>
          {syncMessage}
        </p>
      )}
      {saveFailed && (
        <p className="notes-inline-error" role="alert">
          {t('notes', 'saveFailed')}
        </p>
      )}

      {loadFailed ? (
        <section className="notes-empty-state" role="alert">
          <h2>{t('notes', 'couldNotLoad')}</h2>
          <p>{t('notes', storageMode === 'local' ? 'localLoadHelp' : 'connectionHelp')}</p>
          <Button type="button" variant="ghost" onClick={() => void retry()}>
            <RotateCw size={14} aria-hidden="true" />
            {t('notes', 'tryAgain')}
          </Button>
        </section>
      ) : isLoading && notes.length === 0 ? (
        <div className="notes-loading" role="status" aria-label={t('notes', 'title')}>
          <span />
          <span />
          <span />
        </div>
      ) : notes.length === 0 ? (
        <section className="notes-empty-state">
          <StickyNote size={23} strokeWidth={1.5} aria-hidden="true" />
          <h2>{filteredTicket ? t('notes', 'noMatchesTitle') : t('notes', 'noNotesTitle')}</h2>
          <p>{filteredTicket ? t('notes', 'noMatchesDescription') : t('notes', 'noNotesDescription')}</p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEditingNote(null)
              setIsEditorOpen(true)
            }}
          >
            <Plus size={14} aria-hidden="true" />
            {t('notes', 'newNote')}
          </Button>
        </section>
      ) : (
        <>
          <section
            className="notes-grid"
            aria-label={filteredTicket ? t('notes', 'notesForTicket') : t('notes', 'allNotes')}
          >
            {notes.map((note) => (
              <article className="note-card" key={note.id}>
                <button
                  type="button"
                  className="note-card-open"
                  onClick={() => {
                    setEditingNote(note)
                    setIsEditorOpen(true)
                  }}
                  aria-label={`${t('notes', 'editorEditTitle')}: ${note.title || t('notes', 'untitled')}`}
                >
                  <div className="note-card-topline">
                    <span>{dateFormatter.format(new Date(note.updatedAt))}</span>
                  </div>
                  <h2>{note.title || t('notes', 'untitled')}</h2>
                  <p className="note-card-excerpt">{noteText(note.content).trim() || ' '}</p>
                  <div className="note-card-ticket">
                    <div className="note-card-ticket-topline">
                      <span className="note-card-ticket-label">{t('notes', 'linkedTicket')}</span>
                      <span className={`note-card-status is-${note.ticket.status}`}>
                        {t('tickets', statusKey(note.ticket.status))}
                      </span>
                    </div>
                    <div className="note-card-ticket-main">
                      <span className="note-card-ot">
                        {t('tickets', 'otNumberShort')} {numberFormatter.format(note.ticket.otNumber)}
                      </span>
                      <strong>{note.ticket.title}</strong>
                    </div>
                    <span className="note-card-client">
                      {note.ticket.clientId === null
                        ? t('notes', 'internal')
                        : (note.ticket.clientName ?? t('notes', 'clientUnavailable'))}
                    </span>
                  </div>
                </button>
              </article>
            ))}
          </section>
          {hasPagination && (
            <nav className="notes-pagination" aria-label={t('notes', 'pagination')}>
              <span>
                {t('notes', 'page')} {numberFormatter.format(pageNumber)}
              </span>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={cursorHistory.length === 0 || isLoading}
                  onClick={previousPage}
                >
                  <ChevronLeft size={14} aria-hidden="true" />
                  {t('notes', 'previousPage')}
                </Button>
                <Button type="button" variant="ghost" disabled={!nextCursor || isLoading} onClick={nextPage}>
                  {t('notes', 'nextPage')}
                  <ChevronRight size={14} aria-hidden="true" />
                </Button>
              </div>
            </nav>
          )}
        </>
      )}
    </main>
  )
}
