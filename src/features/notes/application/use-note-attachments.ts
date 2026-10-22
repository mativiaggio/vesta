import { useCallback, useEffect, useRef, useState } from 'react'
import type { NoteAttachment, NoteAttachmentCursor } from '../../../../packages/notes/src/attachment-contract'
import {
  NoteAttachmentApiError,
  deleteRemoteNoteAttachment,
  fetchRemoteNoteAttachmentContent,
  fetchRemoteNoteAttachments,
  noteAttachmentErrorStatus,
  uploadRemoteNoteAttachment,
} from '../data/note-attachment-api-client'
import { downloadBlob } from '../../attachments/download-blob'
import { noteAttachmentImageType } from '../data/note-attachment-preview'
import {
  enqueueNoteAttachmentDelete,
  discardLocalNoteAttachmentsForNote,
  failNoteAttachmentMutation,
  getLocalNoteAttachment,
  getLocalNoteAttachmentBlob,
  getNoteAttachmentMutationSummary,
  getPendingNoteAttachmentMutations,
  listLocalNoteAttachmentPage,
  markNoteAttachmentDeleted,
  markNoteAttachmentMutationSyncing,
  markNoteAttachmentUploaded,
  mergeRemoteNoteAttachments,
  retryNoteAttachmentMutations,
  recoverInterruptedNoteAttachmentMutations,
  savePendingNoteAttachment,
} from '../data/note-attachment-local-store'
import { getLocalNoteSyncMetadata } from '../data/note-local-store'
import { syncPendingNoteMutations } from './note-sync'
import {
  addLocalDesktopNoteAttachments,
  deleteLocalDesktopNoteAttachment,
  loadLocalDesktopNoteAttachments,
  openLocalDesktopNoteAttachment,
  readLocalDesktopNoteAttachmentPreview,
} from '../data/local-desktop-note-attachment'

type StorageMode = 'server' | 'local'

export function useNoteAttachments(
  userId: string,
  workspaceId: string,
  noteId: string | null,
  storageMode: StorageMode,
) {
  const [attachments, setAttachments] = useState<NoteAttachment[]>([])
  const [nextCursor, setNextCursor] = useState<NoteAttachmentCursor | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [hasPendingMutation, setHasPendingMutation] = useState(false)
  const [hasFailedMutation, setHasFailedMutation] = useState(false)
  const [operationFailed, setOperationFailed] = useState(false)
  const mounted = useRef(true)
  const cursorRef = useRef<NoteAttachmentCursor | null>(null)
  const syncPromise = useRef<Promise<void> | null>(null)

  const loadPage = useCallback(
    async (cursor: NoteAttachmentCursor | null = null) => {
      cursorRef.current = cursor
      if (!noteId) {
        setAttachments([])
        setNextCursor(null)
        setIsLoading(false)
        return
      }
      setIsLoading(true)
      try {
        if (storageMode === 'local') {
          const page = await loadLocalDesktopNoteAttachments(workspaceId, noteId, cursor)
          if (!mounted.current) return
          setAttachments(page.attachments)
          setNextCursor(page.nextCursor)
          setHasPendingMutation(false)
          setHasFailedMutation(false)
          return
        }
        const [local, summary] = await Promise.all([
          listLocalNoteAttachmentPage(userId, workspaceId, noteId, cursor),
          getNoteAttachmentMutationSummary(userId, workspaceId, noteId),
        ])
        if (!mounted.current) return
        setAttachments(local.attachments)
        setNextCursor(local.nextCursor)
        setHasPendingMutation(summary.hasPendingMutation)
        setHasFailedMutation(
          summary.hasFailedMutation || local.localAttachments.some((row) => row.syncState === 'failed'),
        )
        if (!navigator.onLine) return
        const remote = await fetchRemoteNoteAttachments(workspaceId, noteId, cursor)
        await mergeRemoteNoteAttachments(userId, workspaceId, remote.attachments)
        const refreshed = await listLocalNoteAttachmentPage(userId, workspaceId, noteId, cursor)
        const refreshedSummary = await getNoteAttachmentMutationSummary(userId, workspaceId, noteId)
        if (!mounted.current) return
        setAttachments(refreshed.attachments)
        setNextCursor(remote.nextCursor)
        setHasPendingMutation(refreshedSummary.hasPendingMutation)
        setHasFailedMutation(
          refreshedSummary.hasFailedMutation || refreshed.localAttachments.some((row) => row.syncState === 'failed'),
        )
      } catch {
        if (mounted.current) setOperationFailed(true)
      } finally {
        if (mounted.current) setIsLoading(false)
      }
    },
    [noteId, storageMode, userId, workspaceId],
  )

  const synchronize = useCallback((): Promise<void> => {
    if (storageMode === 'local' || !navigator.onLine) return Promise.resolve()
    if (syncPromise.current) return syncPromise.current
    const operation = (async () => {
      if (mounted.current) setIsSyncing(true)
      try {
        await recoverInterruptedNoteAttachmentMutations(userId, workspaceId)
        while (navigator.onLine) {
          const pending = await getPendingNoteAttachmentMutations(userId, workspaceId)
          if (pending.length === 0) break
          let madeProgress = false
          for (const mutation of pending) {
            try {
              await syncPendingNoteMutations(userId, workspaceId)
              const note = await getLocalNoteSyncMetadata(userId, workspaceId, mutation.noteId)
              if (!note || note.note.deletedAt !== null) {
                await discardLocalNoteAttachmentsForNote(userId, workspaceId, mutation.noteId)
                madeProgress = true
                continue
              }
              if (note.serverVersion === 0 || note.syncState === 'failed') return
              await markNoteAttachmentMutationSyncing(mutation)
              if (mutation.kind === 'attachment.upload') {
                const local = await getLocalNoteAttachment(userId, workspaceId, mutation.attachmentId)
                if (!(local?.blob instanceof Blob)) throw new Error('Attachment is unavailable in local storage.')
                const uploaded = await uploadRemoteNoteAttachment(
                  workspaceId,
                  mutation.noteId,
                  mutation.attachmentId,
                  new File([local.blob], local.fileName, { type: local.contentType }),
                )
                await markNoteAttachmentUploaded(userId, workspaceId, uploaded)
              } else {
                await deleteRemoteNoteAttachment(workspaceId, mutation.noteId, mutation.attachmentId)
                await markNoteAttachmentDeleted(userId, workspaceId, mutation.attachmentId)
              }
              madeProgress = true
            } catch (error) {
              const status = noteAttachmentErrorStatus(error)
              const permanent =
                status !== null && status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status)
              const message =
                error instanceof NoteAttachmentApiError && error.code
                  ? error.code
                  : error instanceof Error
                    ? error.message
                    : 'Note attachment synchronization failed.'
              await failNoteAttachmentMutation(mutation, message, permanent)
              if (!permanent) return
            }
            if (!navigator.onLine) return
          }
          if (!madeProgress) break
        }
      } finally {
        if (mounted.current) setIsSyncing(false)
      }
    })().finally(() => {
      syncPromise.current = null
    })
    syncPromise.current = operation
    return operation
  }, [storageMode, userId, workspaceId])

  useEffect(() => {
    mounted.current = true
    const initialLoad = window.setTimeout(() => void loadPage(null), 0)
    if (storageMode === 'server') {
      void synchronize().then(() => loadPage(cursorRef.current))
    }
    const handleOnline = () => void synchronize().then(() => loadPage(cursorRef.current))
    window.addEventListener('online', handleOnline)
    return () => {
      mounted.current = false
      window.clearTimeout(initialLoad)
      window.removeEventListener('online', handleOnline)
    }
  }, [loadPage, storageMode, synchronize])

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!noteId || (storageMode !== 'local' && files.length === 0)) return
      setIsUploading(true)
      setOperationFailed(false)
      try {
        if (storageMode === 'local') await addLocalDesktopNoteAttachments(workspaceId, noteId)
        else {
          for (const file of files) {
            await savePendingNoteAttachment(userId, workspaceId, noteId, file)
            if (mounted.current) await loadPage(cursorRef.current)
          }
          if (navigator.onLine) await synchronize()
        }
        await loadPage(cursorRef.current)
      } catch {
        if (mounted.current) setOperationFailed(true)
      } finally {
        if (mounted.current) setIsUploading(false)
      }
    },
    [loadPage, noteId, storageMode, synchronize, userId, workspaceId],
  )

  const remove = useCallback(
    async (attachment: NoteAttachment) => {
      if (!noteId) return
      setOperationFailed(false)
      try {
        if (storageMode === 'local') await deleteLocalDesktopNoteAttachment(workspaceId, noteId, attachment.id)
        else {
          await enqueueNoteAttachmentDelete(userId, workspaceId, noteId, attachment.id)
          await loadPage(cursorRef.current)
          if (navigator.onLine) await synchronize()
        }
        await loadPage(cursorRef.current)
      } catch {
        if (mounted.current) setOperationFailed(true)
      }
    },
    [loadPage, noteId, storageMode, synchronize, userId, workspaceId],
  )

  const open = useCallback(
    async (attachment: NoteAttachment) => {
      if (!noteId) return
      if (storageMode === 'local') {
        await openLocalDesktopNoteAttachment(workspaceId, noteId, attachment.id)
        return
      }
      const cached = await getLocalNoteAttachmentBlob(userId, workspaceId, attachment.id)
      if (cached) {
        downloadBlob(cached, attachment.fileName)
        return
      }
      if (!navigator.onLine) throw new Error('Attachment is not stored on this device.')
      const blob = await fetchRemoteNoteAttachmentContent(workspaceId, noteId, attachment.id)
      downloadBlob(blob, attachment.fileName)
    },
    [noteId, storageMode, userId, workspaceId],
  )

  const loadImagePreview = useCallback(
    async (attachment: NoteAttachment, signal?: AbortSignal): Promise<Blob> => {
      const contentType = noteAttachmentImageType(attachment)
      if (!contentType || !noteId) throw new Error('This attachment is not a supported image.')
      if (storageMode === 'local') {
        const result = await readLocalDesktopNoteAttachmentPreview(workspaceId, noteId, attachment.id)
        if (!(result instanceof ArrayBuffer)) throw new Error('The local image preview is invalid.')
        return new Blob([result], { type: contentType })
      }
      const cached = await getLocalNoteAttachmentBlob(userId, workspaceId, attachment.id)
      if (cached) return cached.slice(0, cached.size, contentType)
      if (!navigator.onLine) throw new Error('Attachment is not stored on this device.')
      const blob = await fetchRemoteNoteAttachmentContent(workspaceId, noteId, attachment.id, signal)
      return blob.slice(0, blob.size, contentType)
    },
    [noteId, storageMode, userId, workspaceId],
  )

  const retry = useCallback(async () => {
    if (!noteId) return
    await retryNoteAttachmentMutations(userId, workspaceId, noteId)
    await synchronize()
    await loadPage(cursorRef.current)
  }, [loadPage, noteId, synchronize, userId, workspaceId])

  return {
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
  }
}
