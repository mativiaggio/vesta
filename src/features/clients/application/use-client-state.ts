import { useCallback, useEffect, useRef, useState } from 'react'
import type { Client, ClientCursor } from '../../../../packages/clients/src/contract'
import {
  ClientCodeConflictError,
  enqueueClientCreation,
  enqueueClientDeletion,
  enqueueClientUpdate,
  loadLocalClientPage,
  mergeClientSyncPage,
  type ClientStateSnapshot,
} from '../data/client-local-store'
import {
  createLocalDesktopClient,
  deleteLocalDesktopClient,
  loadLocalDesktopClients,
  updateLocalDesktopClient,
} from '../data/local-desktop-client'
import { fetchClientPage } from '../data/client-api-client'
import { refreshClientsFromServer, syncPendingClientMutations } from './client-sync'

export type ClientStorageMode = 'server' | 'local'
export type ClientSyncStatus = 'idle' | 'syncing' | 'pending' | 'error'
type ClientChanges = { code?: string; name?: string; active?: boolean }
type ClientPageSnapshot = ClientStateSnapshot & { nextCursor: ClientCursor | null }

export function useClientState(
  userId: string,
  workspaceId: string,
  storageMode: ClientStorageMode,
  cursor: ClientCursor | null,
  search: string,
) {
  const [clients, setClients] = useState<Client[]>([])
  const [nextCursor, setNextCursor] = useState<ClientCursor | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [codeConflict, setCodeConflict] = useState(false)
  const [syncStatus, setSyncStatus] = useState<ClientSyncStatus>('idle')
  const [pendingCount, setPendingCount] = useState(0)
  const isMounted = useRef(true)
  const pageRequestId = useRef(0)
  const syncPromise = useRef<Promise<void> | null>(null)
  const refreshPageRef = useRef<(() => Promise<ClientPageSnapshot>) | null>(null)
  const synchronizeRef = useRef<() => Promise<void>>(() => Promise.resolve())

  const applyPage = useCallback((page: ClientPageSnapshot) => {
    if (!isMounted.current) return
    setClients(page.clients)
    setNextCursor(page.nextCursor)
    setPendingCount(page.pendingCount)
    setSyncStatus(page.hasFailedMutations ? 'error' : page.pendingCount > 0 ? 'pending' : 'idle')
  }, [])

  const readLocalPage = useCallback(async (): Promise<ClientPageSnapshot> => {
    if (storageMode === 'local') {
      const page = await loadLocalDesktopClients(workspaceId, cursor, search)
      return {
        ...page,
        pendingCount: 0,
        hasFailedMutations: false,
        hasLocalData: page.clients.length > 0,
      }
    }
    return loadLocalClientPage(userId, workspaceId, cursor, search)
  }, [cursor, search, storageMode, userId, workspaceId])

  const refreshLocalPage = useCallback(async () => {
    const page = await readLocalPage()
    applyPage(page)
    return page
  }, [applyPage, readLocalPage])

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
        if (isMounted.current) setSyncStatus('pending')
        return
      }
      if (isMounted.current) setSyncStatus('syncing')
      await syncPendingClientMutations(userId, workspaceId)
      const page = await fetchClientPage(workspaceId, cursor, search)
      await mergeClientSyncPage(userId, workspaceId, page)
      const cachedPage = await loadLocalClientPage(userId, workspaceId, cursor, search)
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
  }, [applyPage, cursor, refreshLocalPage, search, storageMode, userId, workspaceId])

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
          await syncPendingClientMutations(userId, workspaceId, controller.signal)
          const remotePage = await fetchClientPage(workspaceId, cursor, search, controller.signal)
          await mergeClientSyncPage(userId, workspaceId, remotePage)
          const synchronizedPage = await loadLocalClientPage(userId, workspaceId, cursor, search)
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
  }, [applyPage, cursor, readLocalPage, search, storageMode, userId, workspaceId])

  useEffect(() => {
    if (storageMode === 'local') return
    const controller = new AbortController()
    const synchronizeReplica = async () => {
      if (!navigator.onLine) return
      try {
        await refreshClientsFromServer(userId, workspaceId, controller.signal)
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

  async function create(input: { code: string; name: string; active: boolean }): Promise<boolean> {
    setIsSaving(true)
    setSaveFailed(false)
    setCodeConflict(false)
    try {
      if (storageMode === 'local') {
        const id = crypto.randomUUID()
        const result = await createLocalDesktopClient({ id, workspaceId, ...input })
        if (isMounted.current) {
          setClients(result.clients)
          setNextCursor(result.nextCursor)
        }
      } else {
        await enqueueClientCreation(userId, workspaceId, input)
        await refreshLocalPage()
        void synchronize()
      }
      return true
    } catch (error) {
      if (error instanceof ClientCodeConflictError) setCodeConflict(true)
      else setSaveFailed(true)
      return false
    } finally {
      setIsSaving(false)
    }
  }

  async function update(clientId: string, changes: ClientChanges): Promise<boolean> {
    const current = clients.find((client) => client.id === clientId)
    if (!current) return false
    setIsSaving(true)
    setSaveFailed(false)
    setCodeConflict(false)
    try {
      if (storageMode === 'local') {
        const result = await updateLocalDesktopClient(
          workspaceId,
          clientId,
          { ...changes, expectedVersion: current.version },
          cursor,
          search,
        )
        if (isMounted.current) {
          setClients(result.clients)
          setNextCursor(result.nextCursor)
        }
      } else {
        await enqueueClientUpdate(userId, workspaceId, clientId, changes)
        await refreshLocalPage()
        void synchronize()
      }
      return true
    } catch (error) {
      if (error instanceof ClientCodeConflictError) setCodeConflict(true)
      else setSaveFailed(true)
      return false
    } finally {
      setIsSaving(false)
    }
  }

  async function remove(clientId: string): Promise<boolean> {
    const current = clients.find((client) => client.id === clientId)
    if (!current) return false
    setIsSaving(true)
    setSaveFailed(false)
    try {
      if (storageMode === 'local') {
        await deleteLocalDesktopClient(workspaceId, clientId, current.version)
        await refreshLocalPage()
      } else {
        await enqueueClientDeletion(userId, workspaceId, clientId)
        await refreshLocalPage()
        void synchronize()
      }
      return true
    } catch {
      setSaveFailed(true)
      return false
    } finally {
      setIsSaving(false)
    }
  }

  async function retry(): Promise<void> {
    setLoadFailed(false)
    try {
      if (storageMode === 'local') await refreshLocalPage()
      else await synchronize()
    } catch {
      if (isMounted.current) setLoadFailed(true)
    }
  }

  return {
    clients,
    nextCursor,
    isLoading,
    loadFailed,
    isSaving,
    saveFailed,
    codeConflict,
    syncStatus,
    pendingCount,
    create,
    update,
    remove,
    retry,
  }
}
