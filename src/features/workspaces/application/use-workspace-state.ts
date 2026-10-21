import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CreateWorkspaceMutation,
  DeleteWorkspaceMutation,
  UpdateWorkspaceMutation,
  Workspace,
  WorkspaceAccent,
  WorkspaceIcon,
} from '../../../../packages/workspaces/src/contract'
import {
  activateLocalDesktopWorkspace,
  createLocalDesktopWorkspace,
  deleteLocalDesktopWorkspace,
  loadLocalDesktopWorkspaceState,
  updateLocalDesktopWorkspace,
} from '../data/local-desktop-workspace-client'
import { fetchWorkspacePage } from '../data/workspace-api-client'
import {
  enqueueWorkspaceActivation,
  enqueueWorkspaceCreation,
  enqueueWorkspaceDeletion,
  enqueueWorkspaceUpdate,
  loadLocalWorkspaceState,
  mergeWorkspacePage,
} from '../data/workspace-local-store'
import { syncPendingWorkspaceMutations } from './workspace-sync'

export type WorkspaceStorageMode = 'server' | 'local'
export type WorkspaceSyncStatus = 'idle' | 'syncing' | 'pending' | 'error'

type WorkspaceStateSnapshot = {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  nextCursor: string | null
  pendingCount: number
  hasFailedMutations: boolean
  hasLocalData: boolean
}

export function useWorkspaceState(userId: string, storageMode: WorkspaceStorageMode = 'server') {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [syncStatus, setSyncStatus] = useState<WorkspaceSyncStatus>('idle')
  const isMounted = useRef(true)
  const syncPromise = useRef<Promise<void> | null>(null)

  const applyLocalDesktopState = useCallback((state: Awaited<ReturnType<typeof loadLocalDesktopWorkspaceState>>) => {
    if (!isMounted.current) return
    setWorkspaces(state.workspaces)
    setActiveWorkspaceId(state.activeWorkspaceId)
    setNextCursor(null)
    setSyncStatus('idle')
  }, [])

  const refreshLocalState = useCallback(async (): Promise<WorkspaceStateSnapshot> => {
    let snapshot: WorkspaceStateSnapshot
    if (storageMode === 'local') {
      const state = await loadLocalDesktopWorkspaceState()
      snapshot = {
        workspaces: state.workspaces,
        activeWorkspaceId: state.activeWorkspaceId,
        nextCursor: null,
        pendingCount: 0,
        hasFailedMutations: false,
        hasLocalData: state.workspaces.length > 0,
      }
    } else {
      snapshot = await loadLocalWorkspaceState(userId)
    }

    if (!isMounted.current) return snapshot
    setWorkspaces(snapshot.workspaces)
    setActiveWorkspaceId(snapshot.activeWorkspaceId)
    setNextCursor(snapshot.nextCursor)
    setSyncStatus(snapshot.hasFailedMutations ? 'error' : snapshot.pendingCount > 0 ? 'pending' : 'idle')
    return snapshot
  }, [storageMode, userId])

  const synchronize = useCallback(() => {
    if (storageMode === 'local') return refreshLocalState().then(() => undefined)
    if (syncPromise.current) return syncPromise.current
    const operation = (async () => {
      if (!navigator.onLine) {
        if (isMounted.current) setSyncStatus('pending')
        return
      }
      if (isMounted.current) setSyncStatus('syncing')
      await syncPendingWorkspaceMutations(userId)
      const state = await refreshLocalState()
      if (isMounted.current) {
        setSyncStatus(state.hasFailedMutations ? 'error' : state.pendingCount > 0 ? 'pending' : 'idle')
      }
    })()
      .catch(() => {
        if (isMounted.current) setSyncStatus('pending')
      })
      .finally(() => {
        syncPromise.current = null
      })
    syncPromise.current = operation
    return operation
  }, [refreshLocalState, storageMode, userId])

  const refreshFromServer = useCallback(
    async (signal?: AbortSignal) => {
      if (storageMode === 'local') {
        await refreshLocalState()
        return
      }
      const page = await fetchWorkspacePage(null, signal)
      await mergeWorkspacePage(userId, page, true)
      await refreshLocalState()
    },
    [refreshLocalState, storageMode, userId],
  )

  useEffect(() => {
    isMounted.current = true
    const controller = new AbortController()

    async function initialize() {
      setIsLoading(true)
      setLoadFailed(false)
      try {
        const localState = await refreshLocalState()
        if (localState.hasLocalData && isMounted.current) setIsLoading(false)
        if (storageMode === 'local') return
        if (navigator.onLine) {
          await synchronize()
          await refreshFromServer(controller.signal)
        } else if (!localState.hasLocalData && isMounted.current) {
          setLoadFailed(true)
        }
      } catch {
        if (storageMode === 'local') {
          if (isMounted.current) setLoadFailed(true)
        } else {
          const localState = await loadLocalWorkspaceState(userId).catch(() => null)
          if (isMounted.current && !localState?.hasLocalData) setLoadFailed(true)
        }
      } finally {
        if (isMounted.current) setIsLoading(false)
      }
    }

    function handleOnline() {
      if (storageMode === 'local') return
      void synchronize().then(() => refreshFromServer())
    }

    void initialize()
    window.addEventListener('online', handleOnline)
    return () => {
      isMounted.current = false
      controller.abort()
      window.removeEventListener('online', handleOnline)
    }
  }, [refreshFromServer, refreshLocalState, storageMode, synchronize, userId])

  async function loadMore() {
    if (storageMode === 'local' || !nextCursor || isLoadingMore) return
    setIsLoadingMore(true)
    setLoadMoreFailed(false)
    try {
      const page = await fetchWorkspacePage(nextCursor)
      await mergeWorkspacePage(userId, page, false)
      await refreshLocalState()
    } catch {
      setLoadMoreFailed(true)
    } finally {
      setIsLoadingMore(false)
    }
  }

  async function activate(workspaceId: string): Promise<boolean> {
    setSaveFailed(false)
    setIsSaving(true)
    try {
      if (storageMode === 'local') {
        applyLocalDesktopState(await activateLocalDesktopWorkspace(workspaceId))
      } else {
        await enqueueWorkspaceActivation(userId, workspaceId, {
          clientMutationId: crypto.randomUUID(),
          accessedAt: new Date().toISOString(),
        })
        await refreshLocalState()
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

  async function create(input: { name: string; accentColor: WorkspaceAccent; icon: WorkspaceIcon }): Promise<boolean> {
    setSaveFailed(false)
    setIsSaving(true)
    const mutation: CreateWorkspaceMutation = {
      ...input,
      id: crypto.randomUUID(),
      clientMutationId: crypto.randomUUID(),
    }
    try {
      if (storageMode === 'local') {
        const localInput = {
          id: mutation.id,
          name: mutation.name,
          accentColor: mutation.accentColor,
          icon: mutation.icon,
        }
        applyLocalDesktopState(await createLocalDesktopWorkspace(localInput))
      } else {
        await enqueueWorkspaceCreation(userId, mutation)
        await refreshLocalState()
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

  async function update(
    workspaceId: string,
    input: Omit<UpdateWorkspaceMutation, 'clientMutationId'>,
  ): Promise<boolean> {
    const workspace = workspaces.find((item) => item.id === workspaceId)
    if (!workspace) return false

    setSaveFailed(false)
    setIsSaving(true)
    try {
      if (storageMode === 'local') {
        applyLocalDesktopState(await updateLocalDesktopWorkspace(workspaceId, input))
      } else {
        const mutation: UpdateWorkspaceMutation = {
          ...input,
          clientMutationId: crypto.randomUUID(),
        }
        await enqueueWorkspaceUpdate(userId, workspaceId, mutation)
        await refreshLocalState()
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

  async function removeWorkspace(
    workspaceId: string,
    input: Omit<DeleteWorkspaceMutation, 'clientMutationId'>,
  ): Promise<boolean> {
    const workspace = workspaces.find((item) => item.id === workspaceId)
    if (!workspace || input.confirmationName !== workspace.name) return false

    setIsSaving(true)
    setSaveFailed(false)
    try {
      if (storageMode === 'local') {
        applyLocalDesktopState(await deleteLocalDesktopWorkspace(workspaceId, input.confirmationName))
      } else {
        const mutation: DeleteWorkspaceMutation = {
          ...input,
          clientMutationId: crypto.randomUUID(),
        }
        await enqueueWorkspaceDeletion(userId, workspaceId, mutation)
        await refreshLocalState()
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

  return {
    workspaces,
    activeWorkspaceId,
    nextCursor,
    isLoading,
    isLoadingMore,
    loadFailed,
    loadMoreFailed,
    isSaving,
    saveFailed,
    syncStatus,
    loadMore,
    activate,
    create,
    update,
    removeWorkspace,
    retry: refreshFromServer,
  }
}
