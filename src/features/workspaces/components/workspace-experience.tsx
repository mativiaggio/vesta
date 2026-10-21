import { useState, type CSSProperties, type FormEvent } from 'react'
import { ArrowLeft, LoaderCircle, Plus, RotateCw } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '../../../components/ui/sidebar'
import { useLanguage } from '../../localization/language-context'
import type { Theme } from '../../preferences/theme-preference'
import { useWorkspaceState } from '../application/use-workspace-state'
import { SettingsDialog } from '../../settings/components/settings-dialog'
import { WorkspaceSettingsDialog } from './workspace-settings-dialog'
import { WorkspaceIconGlyph } from './workspace-icon'
import { WorkspaceAppearanceFields } from './workspace-appearance-fields'
import { workspaceAccentColors } from './workspace-theme'
import { WorkspaceSidebar } from './workspace-sidebar'
import {
  createWorkspaceSchema,
  type WorkspaceAccent,
  type WorkspaceIcon,
} from '../../../../packages/workspaces/src/contract'

type WorkspaceExperienceProps = {
  userId: string
  userName: string
  userEmail: string
  onSignOut: () => void
  theme: Theme
  onThemeChange: (theme: Theme) => void
}

export function WorkspaceExperience({
  userId,
  userName,
  userEmail,
  onSignOut,
  theme,
  onThemeChange,
}: WorkspaceExperienceProps) {
  const { t } = useLanguage()
  const {
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
    retry,
  } = useWorkspaceState(userId)
  const [isCreating, setIsCreating] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [accentColor, setAccentColor] = useState<WorkspaceAccent>('olive')
  const [icon, setIcon] = useState<WorkspaceIcon>('briefcase')
  const [nameError, setNameError] = useState(false)

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
  const editingWorkspace = workspaces.find((workspace) => workspace.id === editingWorkspaceId) ?? null
  const showCreateForm = isCreating || (!isLoading && workspaces.length === 0)
  const isFirstWorkspace = showCreateForm && workspaces.length === 0

  async function activateWorkspace(workspaceId: string) {
    if (await activate(workspaceId)) setIsCreating(false)
  }

  function startCreating() {
    setName('')
    setAccentColor('olive')
    setIcon('briefcase')
    setNameError(false)
    setIsCreating(true)
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNameError(false)
    const parsedInput = createWorkspaceSchema.safeParse({ name, accentColor, icon })
    if (!parsedInput.success) {
      setNameError(true)
      return
    }

    if (await create(parsedInput.data)) setIsCreating(false)
  }

  return (
    <SidebarProvider theme={theme} className={`workspace-app theme-${theme}`}>
      {!isFirstWorkspace && (
        <WorkspaceSidebar
          userName={userName}
          userEmail={userEmail}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          loadFailed={loadFailed}
          loadMoreFailed={loadMoreFailed}
          nextCursor={nextCursor}
          isSaving={isSaving}
          syncStatus={syncStatus}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onActivateWorkspace={(workspaceId) => {
            void activateWorkspace(workspaceId)
          }}
          onEditWorkspace={setEditingWorkspaceId}
          onLoadMore={() => {
            void loadMore()
          }}
          onCreateWorkspace={startCreating}
          onNavigateOverview={() => setIsCreating(false)}
          onSignOut={onSignOut}
        />
      )}
      <SidebarInset className="workspace-main">
        {!isFirstWorkspace && (
          <SidebarTrigger className="workspace-web-sidebar-trigger" aria-label={t('navigation', 'toggleSidebar')} />
        )}
        {saveFailed && !showCreateForm && (
          <p className="workspace-global-error" role="alert">
            {t('workspaces', 'activationFailed')}
          </p>
        )}

        {isLoading ? (
          <div className="workspace-loading" role="status" aria-label={t('app', 'opening')}>
            <span />
            <span />
          </div>
        ) : loadFailed ? (
          <section className="workspace-message-state" role="alert">
            <h1>{t('workspaces', 'couldNotLoad')}</h1>
            <p>{t('workspaces', 'connectionHelp')}</p>
            <Button
              type="button"
              onClick={() => {
                void retry()
              }}
            >
              <RotateCw size={15} aria-hidden="true" />
              {t('workspaces', 'tryAgain')}
            </Button>
          </section>
        ) : showCreateForm ? (
          <section className="workspace-create-wrap" aria-labelledby="workspace-create-title">
            <div className="workspace-create-intro">
              {activeWorkspace && (
                <Button className="workspace-back" variant="ghost" type="button" onClick={() => setIsCreating(false)}>
                  <ArrowLeft size={15} aria-hidden="true" />
                  {t('workspaces', 'backToWorkspace')}
                </Button>
              )}
              <h1 id="workspace-create-title">{t('workspaces', 'createHeading')}</h1>
              <p>{t('workspaces', workspaces.length === 0 ? 'firstWorkspaceDescription' : 'createDescription')}</p>
            </div>
            <form
              className="workspace-create-form"
              onSubmit={(event) => {
                void createWorkspace(event)
              }}
            >
              <div className="workspace-name-field">
                <label htmlFor="workspace-name">{t('workspaces', 'workspaceName')}</label>
                <Input
                  id="workspace-name"
                  name="name"
                  required
                  autoFocus
                  autoComplete="off"
                  maxLength={48}
                  placeholder={t('workspaces', 'namePlaceholder')}
                  value={name}
                  aria-invalid={nameError}
                  aria-describedby={nameError ? 'workspace-name-error' : undefined}
                  onChange={(event) => {
                    setName(event.currentTarget.value)
                    setNameError(false)
                  }}
                />
                {nameError && (
                  <span className="workspace-field-error" id="workspace-name-error">
                    {t('workspaces', 'nameRequired')}
                  </span>
                )}
              </div>

              <WorkspaceAppearanceFields
                accentColor={accentColor}
                icon={icon}
                onAccentColorChange={setAccentColor}
                onIconChange={setIcon}
              />

              <div className="workspace-preview-label">{t('workspaces', 'preview')}</div>
              <div
                className="workspace-preview"
                style={{ '--workspace-accent': workspaceAccentColors[accentColor] } as CSSProperties}
              >
                <span className="workspace-preview-mark">
                  <WorkspaceIconGlyph icon={icon} size={17} />
                </span>
                <span className="workspace-preview-name">{name.trim() || t('workspaces', 'namePlaceholder')}</span>
                <span className="workspace-preview-caption">{t('workspaces', 'workspaceLabel')}</span>
              </div>

              {saveFailed && (
                <p className="workspace-save-error" role="alert">
                  {t('workspaces', 'saveFailed')}
                </p>
              )}
              <Button className="workspace-create-submit" type="submit" disabled={isSaving}>
                {isSaving ? (
                  <LoaderCircle className="loading-icon" size={16} aria-hidden="true" />
                ) : (
                  <Plus size={16} aria-hidden="true" />
                )}
                {t('workspaces', isSaving ? 'creating' : 'createAction')}
              </Button>
            </form>
          </section>
        ) : activeWorkspace ? (
          <section
            className="workspace-home"
            id="overview"
            style={{ '--workspace-accent': workspaceAccentColors[activeWorkspace.accentColor] } as CSSProperties}
          >
            <div className="workspace-home-heading">
              <div>
                <h1>{t('navigation', 'overview')}</h1>
                <span className="workspace-home-label">{activeWorkspace.name}</span>
              </div>
              <span className="workspace-home-mark">
                <WorkspaceIconGlyph icon={activeWorkspace.icon} size={20} />
              </span>
            </div>
            <div className="workspace-home-rule" />
            <div className="workspace-home-empty">
              <img src="/brand/logo-vesta.svg" alt="" />
              <h2>{t('office', 'heading')}</h2>
              <p>{t('office', 'description')}</p>
            </div>
          </section>
        ) : null}
      </SidebarInset>
      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        theme={theme}
        onThemeChange={onThemeChange}
      />
      <WorkspaceSettingsDialog
        key={editingWorkspaceId ?? 'closed'}
        open={editingWorkspaceId !== null && editingWorkspace !== null}
        onOpenChange={(open) => {
          if (!open) setEditingWorkspaceId(null)
        }}
        workspace={editingWorkspace}
        theme={theme}
        isSaving={isSaving}
        onSave={update}
        onDelete={removeWorkspace}
      />
    </SidebarProvider>
  )
}
