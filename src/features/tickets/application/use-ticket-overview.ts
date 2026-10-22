import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadTicketOverview,
  refreshTicketOverviewReplica,
  type TicketOverview,
  type TicketOverviewStorageMode,
} from './ticket-overview'

export function useTicketOverview(userId: string, workspaceId: string, storageMode: TicketOverviewStorageMode) {
  const [overview, setOverview] = useState<TicketOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [retryVersion, setRetryVersion] = useState(0)
  const currentOverview = useRef<TicketOverview | null>(null)

  const retry = useCallback(() => setRetryVersion((version) => version + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    const hasSnapshot = currentOverview.current !== null
    setIsLoading(!hasSnapshot)
    setIsRefreshing(false)
    setLoadFailed(false)
    setRefreshFailed(false)

    async function load() {
      try {
        const localSnapshot = await loadTicketOverview(userId, workspaceId, storageMode, controller.signal)
        if (controller.signal.aborted) return
        currentOverview.current = localSnapshot
        setOverview(localSnapshot)
        setIsLoading(false)
      } catch {
        if (controller.signal.aborted) return
        if (currentOverview.current) setRefreshFailed(true)
        else setLoadFailed(true)
        setIsLoading(false)
        return
      }

      if (storageMode === 'local' || !navigator.onLine) return
      setIsRefreshing(true)
      try {
        await refreshTicketOverviewReplica(userId, workspaceId, controller.signal)
        if (controller.signal.aborted) return
        const refreshedSnapshot = await loadTicketOverview(userId, workspaceId, storageMode, controller.signal)
        if (controller.signal.aborted) return
        currentOverview.current = refreshedSnapshot
        setOverview(refreshedSnapshot)
      } catch {
        if (!controller.signal.aborted) setRefreshFailed(true)
      } finally {
        if (!controller.signal.aborted) setIsRefreshing(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [retryVersion, storageMode, userId, workspaceId])

  useEffect(() => {
    if (storageMode === 'local') return
    const refreshWhenOnline = () => retry()
    window.addEventListener('online', refreshWhenOnline)
    return () => window.removeEventListener('online', refreshWhenOnline)
  }, [retry, storageMode])

  return { overview, isLoading, isRefreshing, loadFailed, refreshFailed, retry }
}
