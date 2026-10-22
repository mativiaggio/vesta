import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CreateTicketMutation,
  Ticket,
  TicketCursor,
  TicketListFilters,
  UpdateTicketMutation,
} from '../../../../packages/tickets/src/contract'
import {
  enqueueTicketCreation,
  enqueueTicketDeletion,
  enqueueTicketUpdate,
  getNextLocalTicketOtNumber,
  loadLocalTicketPage,
  mergeTicketSyncPage,
  type TicketStateSnapshot,
} from '../data/ticket-local-store'
import {
  createLocalDesktopTicket,
  deleteLocalDesktopTicket,
  getNextLocalDesktopTicketOtNumber,
  loadLocalDesktopTickets,
  updateLocalDesktopTicket,
} from '../data/local-desktop-ticket'
import { fetchNextTicketOtNumber, fetchTicketPage } from '../data/ticket-api-client'
import { refreshTicketsFromServer, syncPendingTicketMutations } from './ticket-sync'

export type TicketStorageMode = 'server' | 'local'
export type TicketSyncStatus = 'idle' | 'syncing' | 'pending' | 'error'
type TicketChanges = Omit<Partial<UpdateTicketMutation>, 'expectedVersion' | 'clientMutationId'>
type TicketPageSnapshot = TicketStateSnapshot & { nextCursor: TicketCursor | null }

export function useTicketState(
  userId: string,
  workspaceId: string,
  storageMode: TicketStorageMode,
  cursor: TicketCursor | null,
  filters: TicketListFilters,
) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [nextCursor, setNextCursor] = useState<TicketCursor | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [hasCompleteReplica, setHasCompleteReplica] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [saveOtNumberConflict, setSaveOtNumberConflict] = useState(false)
  const [hasOtNumberConflict, setHasOtNumberConflict] = useState(false)
  const [syncStatus, setSyncStatus] = useState<TicketSyncStatus>('idle')
  const isMounted = useRef(true)
  const pageRequestId = useRef(0)
  const syncPromise = useRef<Promise<void> | null>(null)
  const refreshPageRef = useRef<(() => Promise<TicketPageSnapshot>) | null>(null)
  const synchronizeRef = useRef<() => Promise<void>>(() => Promise.resolve())

  const applyPage = useCallback((page: TicketPageSnapshot) => {
    if (!isMounted.current) return
    setTickets(page.tickets)
    setNextCursor(page.nextCursor)
    setHasCompleteReplica(page.hasCompleteReplica)
    setHasOtNumberConflict(page.hasOtNumberConflict)
    setSyncStatus(page.hasFailedMutations ? 'error' : page.pendingCount > 0 ? 'pending' : 'idle')
  }, [])

  const readLocalPage = useCallback(async (): Promise<TicketPageSnapshot> => {
    if (storageMode === 'local') {
      const page = await loadLocalDesktopTickets(workspaceId, cursor, filters)
      return {
        ...page,
        pendingCount: 0,
        hasFailedMutations: false,
        hasLocalData: page.tickets.length > 0,
        hasCompleteReplica: true,
        hasOtNumberConflict: false,
      }
    }
    return loadLocalTicketPage(userId, workspaceId, cursor, filters)
  }, [cursor, filters, storageMode, userId, workspaceId])

  const refreshLocalPage = useCallback(async () => {
    const page = await readLocalPage()
    applyPage(page)
    return page
  }, [applyPage, readLocalPage])

  const getNextOtNumber = useCallback(async (): Promise<number> => {
    if (storageMode === 'local') return getNextLocalDesktopTicketOtNumber(workspaceId)
    const localSuggestion = await getNextLocalTicketOtNumber(userId, workspaceId)
    if (!navigator.onLine) return localSuggestion
    try {
      const remoteSuggestion = await fetchNextTicketOtNumber(workspaceId)
      return Math.max(localSuggestion, remoteSuggestion)
    } catch {
      return localSuggestion
    }
  }, [storageMode, userId, workspaceId])

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  useEffect(() => {
    refreshPageRef.current = refreshLocalPage
  }, [refreshLocalPage])

  const synchronize = useCallback(() => {
    if (storageMode === 'local') return refreshLocalPage().then(() => undefined)
    if (syncPromise.current) return syncPromise.current
    const operation = (async () => {
      if (!navigator.onLine) {
        return
      }
      if (isMounted.current) setSyncStatus('syncing')
      await syncPendingTicketMutations(userId, workspaceId)
      const page = await fetchTicketPage(workspaceId, cursor, filters)
      await mergeTicketSyncPage(userId, workspaceId, page)
      const cachedPage = await loadLocalTicketPage(userId, workspaceId, cursor, filters)
      applyPage({ ...cachedPage, nextCursor: page.nextCursor })
    })()
      .catch(() => {
        if (isMounted.current) setSyncStatus('pending')
      })
      .finally(() => {
        syncPromise.current = null
      })
    syncPromise.current = operation
    return operation
  }, [applyPage, cursor, filters, refreshLocalPage, storageMode, userId, workspaceId])

  useEffect(() => {
    synchronizeRef.current = synchronize
  }, [synchronize])

  useEffect(() => {
    const controller = new AbortController()
    const requestId = ++pageRequestId.current
    const isCurrent = () => isMounted.current && pageRequestId.current === requestId

    async function loadPage() {
      setIsLoading(true)
      setLoadFailed(false)
      let localPageLoaded = false
      try {
        const localPage = await readLocalPage()
        if (!isCurrent()) return
        applyPage(localPage)
        localPageLoaded = true
        if (storageMode === 'local') return
        if (localPage.hasLocalData || !navigator.onLine) setIsLoading(false)

        if (navigator.onLine) {
          setSyncStatus('syncing')
          await syncPendingTicketMutations(userId, workspaceId, controller.signal)
          const remotePage = await fetchTicketPage(workspaceId, cursor, filters, controller.signal)
          await mergeTicketSyncPage(userId, workspaceId, remotePage)
          const synchronizedPage = await loadLocalTicketPage(userId, workspaceId, cursor, filters)
          if (isCurrent()) applyPage({ ...synchronizedPage, nextCursor: remotePage.nextCursor })
        }
      } catch {
        if (!isCurrent() || controller.signal.aborted) return
        if (!localPageLoaded) setLoadFailed(true)
        else setSyncStatus('pending')
      } finally {
        if (isCurrent()) setIsLoading(false)
      }
    }

    void loadPage()
    return () => controller.abort()
  }, [applyPage, cursor, filters, readLocalPage, storageMode, userId, workspaceId])

  useEffect(() => {
    if (storageMode === 'local') return
    const controller = new AbortController()
    async function synchronizeReplica() {
      if (!navigator.onLine) return
      try {
        await refreshTicketsFromServer(userId, workspaceId, controller.signal)
        if (!controller.signal.aborted) await refreshPageRef.current?.()
      } catch {
        if (!controller.signal.aborted && isMounted.current) setSyncStatus('pending')
      }
    }
    function handleOnline() {
      void synchronizeReplica()
      void synchronizeRef.current()
    }
    void synchronizeReplica()
    window.addEventListener('online', handleOnline)
    return () => {
      controller.abort()
      window.removeEventListener('online', handleOnline)
    }
  }, [storageMode, userId, workspaceId])

  async function create(input: Omit<CreateTicketMutation, 'id' | 'clientMutationId'>, clientName: string | null) {
    setIsSaving(true)
    setSaveFailed(false)
    setSaveOtNumberConflict(false)
    try {
      if (storageMode === 'local') {
        const result = await createLocalDesktopTicket({ id: crypto.randomUUID(), workspaceId, ...input })
        if (isMounted.current) {
          applyPage({
            ...result,
            pendingCount: 0,
            hasFailedMutations: false,
            hasLocalData: true,
            hasCompleteReplica: true,
            hasOtNumberConflict: false,
          })
        }
      } else {
        await enqueueTicketCreation(userId, workspaceId, input, clientName)
        if (isMounted.current) await refreshPageRef.current?.()
        if (navigator.onLine) void synchronizeRef.current()
      }
      return true
    } catch (error) {
      if (isMounted.current) {
        setSaveFailed(true)
        const message = error instanceof Error ? error.message.toLowerCase() : ''
        setSaveOtNumberConflict(
          message === 'ot-number-conflict' ||
            message.includes('unique constraint failed: tickets.workspace_id, tickets.ot_number'),
        )
      }
      return false
    } finally {
      if (isMounted.current) setIsSaving(false)
    }
  }

  async function update(ticketId: string, changes: TicketChanges, clientName: string | null) {
    setIsSaving(true)
    setSaveFailed(false)
    setSaveOtNumberConflict(false)
    try {
      if (storageMode === 'local') {
        const current = tickets.find((ticket) => ticket.id === ticketId)
        if (!current) return false
        const result = await updateLocalDesktopTicket(
          workspaceId,
          ticketId,
          { ...changes, expectedVersion: current.version },
          cursor,
          filters,
        )
        if (isMounted.current) {
          applyPage({
            ...result,
            pendingCount: 0,
            hasFailedMutations: false,
            hasLocalData: true,
            hasCompleteReplica: true,
            hasOtNumberConflict: false,
          })
        }
      } else {
        await enqueueTicketUpdate(userId, workspaceId, ticketId, changes, clientName)
        if (isMounted.current) await refreshPageRef.current?.()
        if (navigator.onLine) void synchronizeRef.current()
      }
      return true
    } catch (error) {
      if (isMounted.current) {
        setSaveFailed(true)
        const message = error instanceof Error ? error.message.toLowerCase() : ''
        setSaveOtNumberConflict(
          message === 'ot-number-conflict' ||
            message.includes('unique constraint failed: tickets.workspace_id, tickets.ot_number'),
        )
      }
      return false
    } finally {
      if (isMounted.current) setIsSaving(false)
    }
  }

  async function remove(ticketId: string) {
    setIsSaving(true)
    setSaveFailed(false)
    try {
      if (storageMode === 'local') {
        const current = tickets.find((ticket) => ticket.id === ticketId)
        if (!current) return false
        await deleteLocalDesktopTicket(workspaceId, ticketId, current.version)
      } else {
        await enqueueTicketDeletion(userId, workspaceId, ticketId)
        if (navigator.onLine) void synchronizeRef.current()
      }
      if (isMounted.current) await refreshPageRef.current?.()
      return true
    } catch {
      if (isMounted.current) setSaveFailed(true)
      return false
    } finally {
      if (isMounted.current) setIsSaving(false)
    }
  }

  async function retry() {
    if (storageMode === 'local') return refreshLocalPage()
    await synchronizeRef.current()
  }

  return {
    tickets,
    nextCursor,
    hasCompleteReplica,
    hasOtNumberConflict,
    isLoading,
    loadFailed,
    isSaving,
    saveFailed,
    saveOtNumberConflict,
    syncStatus,
    create,
    update,
    remove,
    retry,
    getNextOtNumber,
  }
}
