import { useState, type CSSProperties, type FormEvent } from 'react'
import {
  ArrowLeft,
  Briefcase,
  Check,
  ChevronDown,
  Folder,
  Layers,
  Laptop,
  LoaderCircle,
  LogOut,
  Moon,
  NotebookPen,
  Palette,
  Plus,
  RotateCw,
  Sun,
} from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu'
import { useLanguage } from '../../localization/language-context'
import { LanguageSelector } from '../../localization/components/language-selector'
import type { Theme } from '../../preferences/theme-preference'
import { useWorkspaceState } from '../application/use-workspace-state'
import {
  createWorkspaceSchema,
  workspaceAccents,
  workspaceIcons,
  type WorkspaceAccent,
  type WorkspaceIcon,
} from '../../../../packages/workspaces/src/contract'

const accentValues: Record<WorkspaceAccent, string> = {
  olive: '#747a5b',
  blue: '#59758d',
  terracotta: '#a2644e',
  plum: '#80677f',
  teal: '#527a75',
  graphite: '#676a70',
}

const workspaceIconComponents = {
  briefcase: Briefcase,
  folder: Folder,
  layers: Layers,
  'notebook-pen': NotebookPen,
  laptop: Laptop,
  palette: Palette,
} satisfies Record<WorkspaceIcon, typeof Briefcase>

function WorkspaceIconGlyph({ icon, size = 16 }: { icon: WorkspaceIcon; size?: number }) {
  const IconComponent = workspaceIconComponents[icon]
  return <IconComponent size={size} aria-hidden="true" />
}

type WorkspaceExperienceProps = {
  userId: string
  onSignOut: () => void
  theme: Theme
  onToggleTheme: () => void
}

export function WorkspaceExperience({ userId, onSignOut, theme, onToggleTheme }: WorkspaceExperienceProps) {
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
    retry,
  } = useWorkspaceState(userId)
  const [isCreating, setIsCreating] = useState(false)
  const [name, setName] = useState('')
  const [accentColor, setAccentColor] = useState<WorkspaceAccent>('olive')
  const [icon, setIcon] = useState<WorkspaceIcon>('briefcase')
  const [nameError, setNameError] = useState(false)

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
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
    <main className={`workspace-app theme-${theme}`}>
      {!isFirstWorkspace && (
        <header className="workspace-topbar">
          <a className="workspace-brand" href="#home" aria-label={t('app', 'home')}>
            <img src="/brand/logo-vesta.svg" alt="" />
            <span>Vesta</span>
          </a>
          {!isLoading && !loadFailed && workspaces.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="workspace-switcher" variant="ghost" type="button" disabled={isSaving}>
                  {activeWorkspace && (
                    <span
                      className="workspace-switcher-mark"
                      style={{ '--workspace-accent': accentValues[activeWorkspace.accentColor] } as CSSProperties}
                    >
                      <WorkspaceIconGlyph icon={activeWorkspace.icon} size={15} />
                    </span>
                  )}
                  <span className="workspace-switcher-name">
                    {activeWorkspace?.name ?? t('workspaces', 'chooseWorkspace')}
                  </span>
                  <ChevronDown size={14} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="workspace-menu">
                <div className="workspace-menu-heading">{t('workspaces', 'yourWorkspaces')}</div>
                {workspaces.map((workspace) => {
                  return (
                    <DropdownMenuItem
                      key={workspace.id}
                      onSelect={() => {
                        void activateWorkspace(workspace.id)
                      }}
                    >
                      <span className="workspace-menu-option">
                        <span
                          className="workspace-menu-mark"
                          style={{ '--workspace-accent': accentValues[workspace.accentColor] } as CSSProperties}
                        >
                          <WorkspaceIconGlyph icon={workspace.icon} size={14} />
                        </span>
                        <span className="workspace-menu-name">{workspace.name}</span>
                        {workspace.id === activeWorkspaceId && <Check size={14} aria-hidden="true" />}
                      </span>
                    </DropdownMenuItem>
                  )
                })}
                {nextCursor !== null && (
                  <DropdownMenuItem
                    disabled={isLoadingMore}
                    onSelect={() => {
                      void loadMore()
                    }}
                  >
                    <span className="workspace-menu-option">
                      {isLoadingMore ? (
                        <LoaderCircle className="loading-icon" size={14} aria-hidden="true" />
                      ) : (
                        <Plus size={14} aria-hidden="true" />
                      )}
                      <span>
                        {t(
                          'workspaces',
                          isLoadingMore ? 'loadingMore' : loadMoreFailed ? 'loadMoreFailed' : 'loadMore',
                        )}
                      </span>
                    </span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={startCreating}>
                  <span className="workspace-menu-option">
                    <Plus size={15} aria-hidden="true" />
                    <span>{t('workspaces', 'newWorkspace')}</span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="workspace-topbar-end">
            {syncStatus !== 'idle' && (
              <span
                className={`workspace-sync-status is-${syncStatus}`}
                role={syncStatus === 'error' ? 'alert' : 'status'}
              >
                {t(
                  'workspaces',
                  syncStatus === 'syncing' ? 'syncing' : syncStatus === 'error' ? 'syncError' : 'savedLocally',
                )}
              </span>
            )}
            <LanguageSelector />
            <Button
              variant="ghost"
              size="icon"
              className="workspace-theme-toggle"
              type="button"
              aria-label={theme === 'light' ? t('app', 'switchToDark') : t('app', 'switchToLight')}
              onClick={onToggleTheme}
            >
              {theme === 'light' ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
            </Button>
            <Button variant="ghost" className="workspace-signout" type="button" onClick={onSignOut}>
              <LogOut size={15} aria-hidden="true" />
              <span>{t('app', 'signOut')}</span>
            </Button>
          </div>
        </header>
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

            <fieldset className="workspace-choice-group">
              <legend>{t('workspaces', 'accentColor')}</legend>
              <div className="workspace-color-options">
                {workspaceAccents.map((color) => (
                  <button
                    key={color}
                    className={`workspace-color-option${accentColor === color ? ' is-selected' : ''}`}
                    type="button"
                    aria-label={t('workspaces', color)}
                    aria-pressed={accentColor === color}
                    title={t('workspaces', color)}
                    onClick={() => setAccentColor(color)}
                  >
                    <span style={{ backgroundColor: accentValues[color] }} />
                    {accentColor === color && <Check size={13} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset
              className="workspace-choice-group workspace-icon-group"
              style={{ '--workspace-accent': accentValues[accentColor] } as CSSProperties}
            >
              <legend>{t('workspaces', 'identifyWith')}</legend>
              <div className="workspace-icon-options">
                {workspaceIcons.map((iconOption) => {
                  const IconComponent = workspaceIconComponents[iconOption]
                  return (
                    <button
                      key={iconOption}
                      className={`workspace-icon-option${icon === iconOption ? ' is-selected' : ''}`}
                      type="button"
                      aria-label={t('workspaces', iconOption)}
                      aria-pressed={icon === iconOption}
                      title={t('workspaces', iconOption)}
                      onClick={() => setIcon(iconOption)}
                    >
                      <IconComponent size={18} aria-hidden="true" />
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <div className="workspace-preview-label">{t('workspaces', 'preview')}</div>
            <div
              className="workspace-preview"
              style={{ '--workspace-accent': accentValues[accentColor] } as CSSProperties}
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
          style={{ '--workspace-accent': accentValues[activeWorkspace.accentColor] } as CSSProperties}
        >
          <div className="workspace-home-heading">
            <span className="workspace-home-mark">
              <WorkspaceIconGlyph icon={activeWorkspace.icon} size={20} />
            </span>
            <div>
              <span className="workspace-home-label">{t('workspaces', 'workspaceLabel')}</span>
              <h1>{activeWorkspace.name}</h1>
            </div>
          </div>
          <div className="workspace-home-rule" />
          <div className="workspace-home-empty">
            <img src="/brand/logo-vesta.svg" alt="" />
            <h2>{t('office', 'heading')}</h2>
            <p>{t('office', 'description')}</p>
          </div>
        </section>
      ) : null}
    </main>
  )
}
