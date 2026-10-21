import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, LoaderCircle, Pencil, Plus, RotateCw, Search, Trash2, X } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { useLanguage } from '../../localization/language-context'
import type { Theme } from '../../preferences/theme-preference'
import type { Client, ClientCursor } from '../../../../packages/clients/src/contract'
import { useClientState, type ClientStorageMode } from '../application/use-client-state'
import { ClientDeleteDialog } from './client-delete-dialog'
import { ClientFormDialog } from './client-form-dialog'

type ClientsExperienceProps = {
  userId: string
  workspaceId: string
  storageMode: ClientStorageMode
  theme: Theme
}

export function ClientsExperience({ userId, workspaceId, storageMode, theme }: ClientsExperienceProps) {
  const { language, t } = useLanguage()
  const [search, setSearch] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [cursor, setCursor] = useState<ClientCursor | null>(null)
  const [cursorHistory, setCursorHistory] = useState<(ClientCursor | null)[]>([])
  const {
    clients,
    nextCursor,
    isLoading,
    loadFailed,
    isSaving,
    saveFailed,
    codeConflict,
    syncStatus,
    create,
    update,
    remove,
    retry,
  } = useClientState(userId, workspaceId, storageMode, cursor, searchQuery)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [deletingClient, setDeletingClient] = useState<Client | null>(null)

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: 'medium' }), [language])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchQuery(search.trim())
      setCursor(null)
      setCursorHistory([])
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [search])

  function openCreate() {
    setEditingClient(null)
    setIsFormOpen(true)
  }

  function openEdit(client: Client) {
    setEditingClient(client)
    setIsFormOpen(true)
  }

  async function saveClient(clientId: string, values: { code: string; name: string; active: boolean }) {
    const current = clients.find((client) => client.id === clientId)
    if (!current) return false
    const changes = {
      ...(current.code === values.code ? {} : { code: values.code }),
      ...(current.name === values.name ? {} : { name: values.name }),
      ...(current.active === values.active ? {} : { active: values.active }),
    }
    if (Object.keys(changes).length === 0) return true
    return update(clientId, changes)
  }

  async function createClient(values: { code: string; name: string; active: boolean }) {
    const created = await create(values)
    if (created) {
      setSearch('')
      setSearchQuery('')
      setCursor(null)
      setCursorHistory([])
    }
    return created
  }

  function goToPreviousPage() {
    if (cursorHistory.length === 0) return
    setCursor(cursorHistory[cursorHistory.length - 1] ?? null)
    setCursorHistory((history) => history.slice(0, -1))
  }

  function goToNextPage() {
    if (!nextCursor) return
    setCursorHistory((history) => [...history, cursor])
    setCursor(nextCursor)
  }

  const pageNumber = cursorHistory.length + 1
  const hasPagination = cursorHistory.length > 0 || nextCursor !== null

  const syncMessage =
    storageMode === 'local'
      ? null
      : syncStatus === 'syncing'
        ? t('clients', 'syncing')
        : syncStatus === 'pending'
          ? t('clients', 'savedLocally')
          : syncStatus === 'error'
            ? t('clients', 'syncFailed')
            : null

  return (
    <main className="client-page" aria-labelledby="clients-title">
      <header className="client-page-heading">
        <div>
          <h1 id="clients-title">{t('clients', 'title')}</h1>
          <p>{t('clients', 'description')}</p>
        </div>
        <Button type="button" onClick={openCreate}>
          <Plus size={15} aria-hidden="true" />
          {t('clients', 'newClient')}
        </Button>
      </header>

      {syncMessage && (
        <p className={`client-sync-message is-${syncStatus}`} role={syncStatus === 'error' ? 'alert' : 'status'}>
          {syncStatus === 'syncing' && <LoaderCircle size={14} className="client-sync-spinner" aria-hidden="true" />}
          {syncMessage}
        </p>
      )}

      {loadFailed ? (
        <section className="client-message-state" role="alert">
          <h2>{t('clients', 'couldNotLoad')}</h2>
          <p>{t('clients', storageMode === 'local' ? 'localLoadHelp' : 'connectionHelp')}</p>
          <Button type="button" onClick={() => void retry()}>
            <RotateCw size={15} aria-hidden="true" />
            {t('clients', 'tryAgain')}
          </Button>
        </section>
      ) : (
        <>
          <div className="client-toolbar">
            <label className="client-search">
              <Search size={15} aria-hidden="true" />
              <span className="visually-hidden">{t('clients', 'searchLabel')}</span>
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder={t('clients', 'searchPlaceholder')}
                autoComplete="off"
                maxLength={120}
              />
              {search.length > 0 && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="client-search-clear"
                  aria-label={t('clients', 'clearSearch')}
                  title={t('clients', 'clearSearch')}
                  onClick={() => setSearch('')}
                >
                  <X size={13} aria-hidden="true" />
                </Button>
              )}
            </label>
            {isLoading && (
              <span className="client-loading-label" role="status">
                {t('clients', 'loading')}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="client-list-loading" role="status">
              <span />
              <span />
              <span />
            </div>
          ) : clients.length === 0 ? (
            <section className="client-empty-state">
              <h2>{searchQuery ? t('clients', 'noMatches') : t('clients', 'emptyTitle')}</h2>
              <p>{searchQuery ? t('clients', 'noMatchesDescription') : t('clients', 'emptyDescription')}</p>
              {!searchQuery && (
                <Button type="button" className="client-empty-action" onClick={openCreate}>
                  <Plus size={15} aria-hidden="true" />
                  {t('clients', 'newClient')}
                </Button>
              )}
            </section>
          ) : (
            <div className="client-table-wrap">
              <table className="client-table">
                <thead>
                  <tr>
                    <th scope="col">{t('clients', 'code')}</th>
                    <th scope="col">{t('clients', 'name')}</th>
                    <th scope="col">{t('clients', 'status')}</th>
                    <th scope="col">{t('clients', 'modified')}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t('clients', 'actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((client) => (
                    <tr key={client.id}>
                      <td className="client-code">{client.code}</td>
                      <td className="client-name">{client.name}</td>
                      <td>
                        <span className={`client-status-badge ${client.active ? 'is-active' : 'is-inactive'}`}>
                          <span className="client-status-dot" aria-hidden="true" />
                          {t('clients', client.active ? 'active' : 'inactive')}
                        </span>
                      </td>
                      <td className="client-modified">{dateFormatter.format(new Date(client.updatedAt))}</td>
                      <td>
                        <div className="client-row-actions">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`${t('clients', 'edit')} ${client.name}`}
                            title={t('clients', 'edit')}
                            onClick={() => openEdit(client)}
                          >
                            <Pencil size={14} aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="client-row-delete"
                            aria-label={`${t('clients', 'delete')} ${client.name}`}
                            title={t('clients', 'delete')}
                            onClick={() => setDeletingClient(client)}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {hasPagination && (
            <nav className="client-pagination" aria-label={t('clients', 'pagination')}>
              <span>
                {t('clients', 'page')} {pageNumber}
              </span>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  className="client-pagination-button"
                  onClick={goToPreviousPage}
                  disabled={cursorHistory.length === 0 || isLoading}
                >
                  <ChevronLeft size={14} aria-hidden="true" />
                  {t('clients', 'previousPage')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="client-pagination-button"
                  onClick={goToNextPage}
                  disabled={!nextCursor || isLoading}
                >
                  {t('clients', 'nextPage')}
                  <ChevronRight size={14} aria-hidden="true" />
                </Button>
              </div>
            </nav>
          )}
        </>
      )}

      <ClientFormDialog
        key={`${editingClient?.id ?? 'new-client'}-${isFormOpen ? 'open' : 'closed'}`}
        open={isFormOpen}
        client={editingClient}
        theme={theme}
        isSaving={isSaving}
        codeConflict={codeConflict}
        saveFailed={saveFailed}
        onOpenChange={(open) => {
          setIsFormOpen(open)
          if (!open) setEditingClient(null)
        }}
        onCreate={createClient}
        onUpdate={saveClient}
      />
      <ClientDeleteDialog
        client={deletingClient}
        theme={theme}
        isSaving={isSaving}
        saveFailed={saveFailed}
        onOpenChange={(open) => {
          if (!open) setDeletingClient(null)
        }}
        onDelete={remove}
      />
    </main>
  )
}
