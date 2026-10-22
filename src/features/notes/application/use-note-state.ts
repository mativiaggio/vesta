import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CreateNoteMutation,
  Note,
  NoteCursor,
  NoteListFilters,
  UpdateNoteMutation,
} from '../../../../packages/notes/src/contract'
import { fetchNotePage } from '../data/note-api-client'
import {
  enqueueNoteCreation,
  enqueueNoteDeletion,
  enqueueNoteUpdate,
  loadLocalNotePage,
  mergeNoteSyncPage,
  resolveNoteConflictDeleteLatest,
  resolveNoteConflictWithLocal,
  resolveNoteConflictWithRemote,
  retryFailedNoteMutations,
  type LocalNoteView,
  type NotePageSnapshot,
} from '../data/note-local-store'
import {
  createLocalDesktopNote,
  deleteLocalDesktopNote,
  loadLocalDesktopNotes,
  updateLocalDesktopNote,
} from '../data/local-desktop-note'
import { refreshNotesFromServer, syncPendingNoteMutations } from './note-sync'
import { discardLocalNoteAttachmentsForNote } from '../data/note-attachment-local-store'

export type NoteStorageMode = 'server' | 'local'
export type NoteSyncStatus = 'idle' | 'syncing' | 'pending' | 'error'
type NoteChanges = Pick<UpdateNoteMutation, 'ticketId' | 'title' | 'content'>
export type NoteConflictResolution = 'remote' | 'local' | 'delete-latest'

export function useNoteState(
  userId: string,
  workspaceId: string,
  storageMode: NoteStorageMode,
  cursor: NoteCursor | null,
  filters: NoteListFilters,
) {
  const [notes, setNotes] = useState<LocalNoteView[]>([])
  const [nextCursor, setNextCursor] = useState<NoteCursor | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [syncStatus, setSyncStatus] = useState<NoteSyncStatus>('idle')
  const mounted = useRef(true)
  const requestId = useRef(0)
  const syncPromise = useRef<Promise<void> | null>(null)

  const applySnapshot = useCallback((snapshot: NotePageSnapshot) => {
    if (!mounted.current) return
    setNotes(snapshot.notes)
    setNextCursor(snapshot.nextCursor)
    setSyncStatus(snapshot.hasFailedMutations ? 'error' : snapshot.pendingCount > 0 ? 'pending' : 'idle')
  }, [])

  const readLocalPage = useCallback(async (): Promise<NotePageSnapshot> => {
    if (storageMode === 'local') {
      const page = await loadLocalDesktopNotes(workspaceId, cursor, filters)
      return {
        ...page,
        pendingCount: 0,
        hasFailedMutations: false,
        hasLocalData: page.notes.length > 0,
        hasCompleteReplica: true,
      }
    }
    return loadLocalNotePage(userId, workspaceId, cursor, filters)
  }, [cursor, filters, storageMode, userId, workspaceId])

  const refreshLocalPage = useCallback(async () => {
    const page = await readLocalPage()
    applySnapshot(page)
    return page
  }, [applySnapshot, readLocalPage])

  const synchronize = useCallback((): Promise<void> => {
    if (storageMode === 'local' || !navigator.onLine) return refreshLocalPage().then(() => undefined)
    if (syncPromise.current) return syncPromise.current
    const operation = (async () => {
      setSyncStatus('syncing')
      try {
        await syncPendingNoteMutations(userId, workspaceId)
        const remotePage = await fetchNotePage(workspaceId, cursor, filters)
        await mergeNoteSyncPage(userId, workspaceId, remotePage.notes)
        const localPage = await loadLocalNotePage(userId, workspaceId, cursor, filters)
        applySnapshot({ ...localPage, nextCursor: remotePage.nextCursor })
      } catch {
        if (mounted.current) setSyncStatus('pending')
      }
    })().finally(() => {
      syncPromise.current = null
    })
    syncPromise.current = operation
    return operation
  }, [applySnapshot, cursor, filters, refreshLocalPage, storageMode, userId, workspaceId])

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    const currentRequest = ++requestId.current
    const isCurrent = () => mounted.current && requestId.current === currentRequest

    async function loadPage() {
      setIsLoading(true)
      setLoadFailed(false)
      let localLoaded = false
      try {
        const localPage = await readLocalPage()
        if (!isCurrent()) return
        applySnapshot(localPage)
        localLoaded = true
        if (storageMode === 'local') return
        if (localPage.hasLocalData || !navigator.onLine) setIsLoading(false)

        if (navigator.onLine) {
          await syncPendingNoteMutations(userId, workspaceId, controller.signal)
          const remotePage = await fetchNotePage(workspaceId, cursor, filters, controller.signal)
          if (controller.signal.aborted) return
          await mergeNoteSyncPage(userId, workspaceId, remotePage.notes)
          const synchronized = await loadLocalNotePage(userId, workspaceId, cursor, filters)
          if (isCurrent()) applySnapshot({ ...synchronized, nextCursor: remotePage.nextCursor })
        }
      } catch {
        if (!isCurrent() || controller.signal.aborted) return
        if (!localLoaded) setLoadFailed(true)
        else setSyncStatus('pending')
      } finally {
        if (isCurrent()) setIsLoading(false)
      }
    }

    void loadPage()
    return () => controller.abort()
  }, [applySnapshot, cursor, filters, readLocalPage, storageMode, userId, workspaceId])

  useEffect(() => {
    if (storageMode === 'local') return
    const controller = new AbortController()
    async function hydrateReplica() {
      if (!navigator.onLine) return
      try {
        await refreshNotesFromServer(userId, workspaceId, controller.signal)
        if (!controller.signal.aborted) await refreshLocalPage()
      } catch {
        if (!controller.signal.aborted && mounted.current) setSyncStatus('pending')
      }
    }
    function handleOnline() {
      void hydrateReplica()
      void synchronize()
    }
    void hydrateReplica()
    window.addEventListener('online', handleOnline)
    return () => {
      controller.abort()
      window.removeEventListener('online', handleOnline)
    }
  }, [refreshLocalPage, storageMode, synchronize, userId, workspaceId])

  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )

  const create = useCallback(
    async (
      input: Omit<CreateNoteMutation, 'id' | 'clientMutationId'>,
      ticket: Note['ticket'],
    ): Promise<Note | null> => {
      setIsSaving(true)
      setSaveFailed(false)
      try {
        if (storageMode === 'local') {
          const id = crypto.randomUUID()
          const page = await createLocalDesktopNote({ id, workspaceId, ...input })
          const created = page.notes.find((note) => note.id === id) ?? page.notes[0] ?? null
          if (mounted.current) await refreshLocalPage()
          return created
        }
        const created = await enqueueNoteCreation(userId, workspaceId, input, ticket)
        if (mounted.current) await refreshLocalPage()
        if (navigator.onLine) void synchronize()
        return created
      } catch {
        if (mounted.current) setSaveFailed(true)
        return null
      } finally {
        if (mounted.current) setIsSaving(false)
      }
    },
    [refreshLocalPage, storageMode, synchronize, userId, workspaceId],
  )

  const update = useCallback(
    async (note: Note, changes: NoteChanges, ticket: Note['ticket']): Promise<boolean> => {
      setIsSaving(true)
      setSaveFailed(false)
      try {
        if (storageMode === 'local') {
          await updateLocalDesktopNote(
            workspaceId,
            note.id,
            { ...changes, expectedVersion: note.version },
            cursor,
            filters,
          )
        } else {
          await enqueueNoteUpdate(userId, workspaceId, note.id, changes, ticket)
          if (navigator.onLine) void synchronize()
        }
        if (mounted.current) await refreshLocalPage()
        return true
      } catch {
        if (mounted.current) setSaveFailed(true)
        return false
      } finally {
        if (mounted.current) setIsSaving(false)
      }
    },
    [cursor, filters, refreshLocalPage, storageMode, synchronize, userId, workspaceId],
  )

  const remove = useCallback(
    async (note: Note): Promise<boolean> => {
      setIsSaving(true)
      setSaveFailed(false)
      try {
        if (storageMode === 'local') await deleteLocalDesktopNote(workspaceId, note.id, note.version)
        else {
          const deletion = await enqueueNoteDeletion(userId, workspaceId, note.id)
          if (deletion.canceledBeforeSync) await discardLocalNoteAttachmentsForNote(userId, workspaceId, note.id)
          if (navigator.onLine) void synchronize()
        }
        if (mounted.current) await refreshLocalPage()
        return true
      } catch {
        if (mounted.current) setSaveFailed(true)
        return false
      } finally {
        if (mounted.current) setIsSaving(false)
      }
    },
    [refreshLocalPage, storageMode, synchronize, userId, workspaceId],
  )

  const retry = useCallback(async () => {
    if (storageMode === 'local') return refreshLocalPage()
    await retryFailedNoteMutations(userId, workspaceId)
    await synchronize()
  }, [refreshLocalPage, storageMode, synchronize, userId, workspaceId])

  const resolveConflict = useCallback(
    async (note: Note, resolution: NoteConflictResolution): Promise<boolean> => {
      if (storageMode === 'local') return false
      setIsSaving(true)
      setSaveFailed(false)
      try {
        if (resolution === 'remote') await resolveNoteConflictWithRemote(userId, workspaceId, note.id)
        else if (resolution === 'local') await resolveNoteConflictWithLocal(userId, workspaceId, note.id)
        else await resolveNoteConflictDeleteLatest(userId, workspaceId, note.id)
        if (navigator.onLine) await synchronize()
        if (mounted.current) await refreshLocalPage()
        return true
      } catch {
        if (mounted.current) setSaveFailed(true)
        return false
      } finally {
        if (mounted.current) setIsSaving(false)
      }
    },
    [refreshLocalPage, storageMode, synchronize, userId, workspaceId],
  )

  return {
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
  }
}
