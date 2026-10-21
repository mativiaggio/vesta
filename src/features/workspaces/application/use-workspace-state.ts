import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CreateWorkspaceMutation,
  DeleteWorkspaceMutation,
  UpdateWorkspaceMutation,
  Workspace,
  WorkspaceAccent,
  WorkspaceIcon,
} from '../../../../packages/workspaces/src/contract'
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

export type WorkspaceSyncStatus = 'idle' | 'syncing' | 'pending' | 'error'

export function useWorkspaceState(userId: string) {
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

  const refreshLocalState = useCallback(async () => {
    const state = await loadLocalWorkspaceState(userId)
    if (!isMounted.current) return state
    setWorkspaces(state.workspaces)
    setActiveWorkspaceId(state.activeWorkspaceId)
    setNextCursor(state.nextCursor)
    setSyncStatus(state.hasFailedMutations ? 'error' : state.pendingCount > 0 ? 'pending' : 'idle')
    return state
  }, [userId])

  const synchronize = useCallback(() => {
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
  }, [refreshLocalState, userId])

  const refreshFromServer = useCallback(
    async (signal?: AbortSignal) => {
      const page = await fetchWorkspacePage(null, signal)
      await mergeWorkspacePage(userId, page, true)
      await refreshLocalState()
    },
    [refreshLocalState, userId],
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
        if (navigator.onLine) {
          await synchronize()
          await refreshFromServer(controller.signal)
        } else if (!localState.hasLocalData && isMounted.current) {
          setLoadFailed(true)
        }
      } catch {
        const localState = await loadLocalWorkspaceState(userId).catch(() => null)
        if (isMounted.current && !localState?.hasLocalData) setLoadFailed(true)
      } finally {
        if (isMounted.current) setIsLoading(false)
      }
    }

    function handleOnline() {
      void synchronize().then(() => refreshFromServer())
    }

    void initialize()
    window.addEventListener('online', handleOnline)
    return () => {
      isMounted.current = false
      controller.abort()
      window.removeEventListener('online', handleOnline)
    }
  }, [refreshFromServer, refreshLocalState, synchronize, userId])

  async function loadMore() {
    if (!nextCursor || isLoadingMore) return
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
      await enqueueWorkspaceActivation(userId, workspaceId, {
        clientMutationId: crypto.randomUUID(),
        accessedAt: new Date().toISOString(),
      })
      await refreshLocalState()
      void synchronize()
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
      await enqueueWorkspaceCreation(userId, mutation)
      await refreshLocalState()
      void synchronize()
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
    const mutation: UpdateWorkspaceMutation = {
      ...input,
      clientMutationId: crypto.randomUUID(),
    }
    try {
      await enqueueWorkspaceUpdate(userId, workspaceId, mutation)
      await refreshLocalState()
      void synchronize()
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
    try {
      const mutation: DeleteWorkspaceMutation = {
        ...input,
        clientMutationId: crypto.randomUUID(),
      }
      await enqueueWorkspaceDeletion(userId, workspaceId, mutation)
      await refreshLocalState()
      void synchronize()
      return true
    } catch {
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
