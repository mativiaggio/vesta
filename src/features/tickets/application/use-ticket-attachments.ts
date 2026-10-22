import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ticketAttachmentSchema,
  type TicketAttachment,
  type TicketAttachmentCursor,
} from '../../../../packages/tickets/src/attachment-contract'
import type { TicketStorageMode } from './use-ticket-state'
import {
  deleteRemoteTicketAttachment,
  fetchRemoteTicketAttachmentContent,
  fetchRemoteTicketAttachments,
  ticketAttachmentErrorStatus,
  uploadRemoteTicketAttachment,
} from '../data/ticket-attachment-api-client'
import { downloadBlob } from '../../attachments/download-blob'
import {
  addLocalDesktopTicketAttachments,
  deleteLocalDesktopTicketAttachment,
  loadLocalDesktopTicketAttachments,
  openLocalDesktopTicketAttachment,
  openLocalDesktopTicketAttachmentFolder,
  readLocalDesktopTicketAttachmentPreview,
} from '../data/local-desktop-attachment'
import { ticketAttachmentImageType } from '../data/ticket-attachment-preview'
import {
  enqueueTicketAttachmentDelete,
  failTicketAttachmentMutation,
  getLocalTicketAttachment,
  getLocalTicketAttachmentBlob,
  getPendingTicketAttachmentMutations,
  getTicketAttachmentMutationSummary,
  listLocalTicketAttachmentPage,
  markTicketAttachmentDeleted,
  markTicketAttachmentUploaded,
  mergeRemoteTicketAttachments,
  retryTicketAttachmentMutations,
  savePendingTicketAttachment,
} from '../data/ticket-attachment-local-store'
type TicketAttachmentsHook = {
  attachments: TicketAttachment[]
  nextCursor: TicketAttachmentCursor | null
  isLoading: boolean
  isUploading: boolean
  isSyncing: boolean
  hasPendingMutation: boolean
  hasFailedMutation: boolean
  operationFailed: boolean
  loadPage: (cursor: TicketAttachmentCursor | null) => Promise<void>
  addFiles: (files?: File[]) => Promise<void>
  remove: (attachment: TicketAttachment) => Promise<void>
  open: (attachment: TicketAttachment) => Promise<void>
  loadImagePreview: (attachment: TicketAttachment, signal?: AbortSignal) => Promise<Blob>
  openFolder: () => Promise<void>
  retry: () => Promise<void>
}

function toVisibleAttachment(row: unknown): TicketAttachment {
  return ticketAttachmentSchema.parse(row)
}

export function useTicketAttachments(
  userId: string,
  workspaceId: string,
  ticketId: string,
  storageMode: TicketStorageMode,
): TicketAttachmentsHook {
  const [attachments, setAttachments] = useState<TicketAttachment[]>([])
  const [nextCursor, setNextCursor] = useState<TicketAttachmentCursor | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [hasPendingMutation, setHasPendingMutation] = useState(false)
  const [hasFailedMutation, setHasFailedMutation] = useState(false)
  const [operationFailed, setOperationFailed] = useState(false)
  const mounted = useRef(false)
  const syncPromise = useRef<Promise<void> | null>(null)
  const pageCursor = useRef<TicketAttachmentCursor | null>(null)

  const loadPage = useCallback(
    async (cursor: TicketAttachmentCursor | null) => {
      pageCursor.current = cursor
      setIsLoading(true)
      setOperationFailed(false)
      try {
        if (storageMode === 'local') {
          const page = await loadLocalDesktopTicketAttachments(workspaceId, ticketId, cursor)
          if (mounted.current) {
            setAttachments(page.attachments)
            setNextCursor(page.nextCursor)
            setHasPendingMutation(false)
            setHasFailedMutation(false)
          }
          return
        }

        const [local, mutationSummary] = await Promise.all([
          listLocalTicketAttachmentPage(userId, workspaceId, ticketId, cursor),
          getTicketAttachmentMutationSummary(userId, workspaceId, ticketId),
        ])
        if (!navigator.onLine) {
          if (mounted.current) {
            setAttachments(local.attachments)
            setNextCursor(local.nextCursor)
            setHasPendingMutation(mutationSummary.hasPendingMutation)
            setHasFailedMutation(
              mutationSummary.hasFailedMutation || local.localAttachments.some((row) => row.syncState === 'failed'),
            )
          }
          return
        }

        try {
          const remote = await fetchRemoteTicketAttachments(workspaceId, ticketId, cursor)
          const visibleRemote = await mergeRemoteTicketAttachments(userId, workspaceId, remote.attachments)
          const remoteIds = new Set(visibleRemote.map((attachment) => attachment.id))
          const pendingLocal = local.localAttachments
            .filter((row) => (row.syncState === 'pending' || row.syncState === 'failed') && !remoteIds.has(row.id))
            .map(toVisibleAttachment)
          if (mounted.current) {
            setAttachments([...visibleRemote, ...pendingLocal].sort(compareAttachments))
            setNextCursor(remote.nextCursor)
            setHasPendingMutation(mutationSummary.hasPendingMutation)
            setHasFailedMutation(
              mutationSummary.hasFailedMutation ||
                pendingLocal.some((attachment) =>
                  local.localAttachments.some((row) => row.id === attachment.id && row.syncState === 'failed'),
                ),
            )
          }
        } catch {
          if (mounted.current) {
            setAttachments(local.attachments)
            setNextCursor(local.nextCursor)
            setHasPendingMutation(mutationSummary.hasPendingMutation)
            setHasFailedMutation(
              mutationSummary.hasFailedMutation || local.localAttachments.some((row) => row.syncState === 'failed'),
            )
          }
        }
      } catch {
        if (mounted.current) setOperationFailed(true)
      } finally {
        if (mounted.current) setIsLoading(false)
      }
    },
    [storageMode, ticketId, userId, workspaceId],
  )

  const synchronize = useCallback((): Promise<void> => {
    if (storageMode === 'local' || !navigator.onLine) return Promise.resolve()
    if (syncPromise.current) return syncPromise.current
    const operation = (async () => {
      if (mounted.current) setIsSyncing(true)
      try {
        while (navigator.onLine) {
          const pending = await getPendingTicketAttachmentMutations(userId, workspaceId)
          if (pending.length === 0) break
          let madeProgress = false
          for (const mutation of pending) {
            try {
              if (mutation.kind === 'attachment.upload') {
                const local = await getLocalTicketAttachment(userId, workspaceId, mutation.attachmentId)
                if (!(local?.blob instanceof Blob)) throw new Error('Attachment is unavailable in local storage.')
                const uploaded = await uploadRemoteTicketAttachment(
                  workspaceId,
                  mutation.ticketId,
                  mutation.attachmentId,
                  new File([local.blob], local.fileName, { type: local.contentType }),
                )
                await markTicketAttachmentUploaded(userId, workspaceId, uploaded)
              } else {
                await deleteRemoteTicketAttachment(workspaceId, mutation.ticketId, mutation.attachmentId)
                await markTicketAttachmentDeleted(userId, workspaceId, mutation.attachmentId)
              }
              madeProgress = true
            } catch (error) {
              const status = ticketAttachmentErrorStatus(error)
              if (status !== null && status >= 400 && status < 500 && status !== 401 && status !== 429) {
                await failTicketAttachmentMutation(userId, workspaceId, mutation, 'conflict')
                madeProgress = true
              } else {
                break
              }
            }
            if (!navigator.onLine) break
          }
          if (!madeProgress) break
        }
      } finally {
        if (mounted.current) {
          setIsSyncing(false)
        }
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
      void synchronize()
        .then(() => loadPage(pageCursor.current))
        .catch(() => {
          if (mounted.current) setOperationFailed(true)
        })
    }
    const handleOnline = () => {
      void synchronize()
        .catch(() => undefined)
        .then(() => loadPage(pageCursor.current))
    }
    window.addEventListener('online', handleOnline)
    return () => {
      mounted.current = false
      window.clearTimeout(initialLoad)
      window.removeEventListener('online', handleOnline)
    }
  }, [loadPage, storageMode, synchronize])

  const addFiles = useCallback(
    async (files?: File[]) => {
      setIsUploading(true)
      setOperationFailed(false)
      try {
        if (storageMode === 'local') {
          await addLocalDesktopTicketAttachments(workspaceId, ticketId)
        } else {
          for (const file of files ?? []) {
            const attachmentId = crypto.randomUUID()
            await savePendingTicketAttachment(userId, workspaceId, ticketId, attachmentId, file)
            if (mounted.current) await loadPage(pageCursor.current)
          }
          if (navigator.onLine) await synchronize()
        }
        await loadPage(pageCursor.current)
      } catch {
        if (mounted.current) {
          await loadPage(pageCursor.current)
          setOperationFailed(true)
        }
      } finally {
        if (mounted.current) setIsUploading(false)
      }
    },
    [loadPage, storageMode, synchronize, ticketId, userId, workspaceId],
  )

  const remove = useCallback(
    async (attachment: TicketAttachment) => {
      setOperationFailed(false)
      try {
        if (storageMode === 'local') {
          await deleteLocalDesktopTicketAttachment(workspaceId, ticketId, attachment.id)
        } else {
          await enqueueTicketAttachmentDelete(userId, workspaceId, ticketId, attachment.id)
          await loadPage(pageCursor.current)
          if (navigator.onLine) await synchronize()
        }
        await loadPage(pageCursor.current)
      } catch {
        if (mounted.current) setOperationFailed(true)
      }
    },
    [loadPage, storageMode, synchronize, ticketId, userId, workspaceId],
  )

  const open = useCallback(
    async (attachment: TicketAttachment) => {
      if (storageMode === 'local') {
        await openLocalDesktopTicketAttachment(workspaceId, ticketId, attachment.id)
        return
      }
      const cachedBlob = await getLocalTicketAttachmentBlob(userId, workspaceId, attachment.id)
      if (cachedBlob) {
        downloadBlob(cachedBlob, attachment.fileName)
        return
      }
      if (!navigator.onLine) throw new Error('Attachment is not stored on this device.')
      const blob = await fetchRemoteTicketAttachmentContent(workspaceId, ticketId, attachment.id)
      downloadBlob(blob, attachment.fileName)
    },
    [storageMode, ticketId, userId, workspaceId],
  )

  const loadImagePreview = useCallback(
    async (attachment: TicketAttachment, signal?: AbortSignal): Promise<Blob> => {
      const contentType = ticketAttachmentImageType(attachment)
      if (!contentType) throw new Error('This attachment is not a supported image.')
      if (storageMode === 'local') {
        const result = await readLocalDesktopTicketAttachmentPreview(workspaceId, ticketId, attachment.id)
        if (!(result instanceof ArrayBuffer)) throw new Error('The local image preview is invalid.')
        return new Blob([result], { type: contentType })
      }
      const cachedBlob = await getLocalTicketAttachmentBlob(userId, workspaceId, attachment.id)
      if (cachedBlob) return cachedBlob.slice(0, cachedBlob.size, contentType)
      if (!navigator.onLine) throw new Error('Attachment is not stored on this device.')
      const remoteBlob = await fetchRemoteTicketAttachmentContent(workspaceId, ticketId, attachment.id, signal)
      return remoteBlob.slice(0, remoteBlob.size, contentType)
    },
    [storageMode, ticketId, userId, workspaceId],
  )

  const openFolder = useCallback(async () => {
    if (storageMode === 'local') await openLocalDesktopTicketAttachmentFolder()
  }, [storageMode])

  const retry = useCallback(async () => {
    await retryTicketAttachmentMutations(userId, workspaceId, ticketId)
    await synchronize()
    await loadPage(pageCursor.current)
  }, [loadPage, synchronize, ticketId, userId, workspaceId])

  return useMemo(
    () => ({
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
      openFolder,
      retry,
    }),
    [
      addFiles,
      attachments,
      hasFailedMutation,
      hasPendingMutation,
      isLoading,
      isSyncing,
      isUploading,
      loadPage,
      nextCursor,
      open,
      loadImagePreview,
      openFolder,
      operationFailed,
      remove,
      retry,
    ],
  )
}

function compareAttachments(left: TicketAttachment, right: TicketAttachment): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}
