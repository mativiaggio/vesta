import type { CSSProperties } from 'react'
import {
  Check,
  ChevronDown,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Pencil,
  Plus,
  Settings2,
  Ticket,
  Users,
  UserRound,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../../../components/ui/sidebar'
import { useSidebar } from '../../../components/ui/sidebar-context'
import { TooltipProvider } from '../../../components/ui/tooltip'
import { useLanguage } from '../../localization/language-context'
import type { WorkspaceStorageMode, useWorkspaceState } from '../application/use-workspace-state'
import { WorkspaceIconGlyph } from './workspace-icon'
import { workspaceAccentColors } from './workspace-theme'

type Workspace = ReturnType<typeof useWorkspaceState>['workspaces'][number]
type SyncStatus = ReturnType<typeof useWorkspaceState>['syncStatus']

type WorkspaceSidebarProps = {
  userName: string
  userDetail: string
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  isLoading: boolean
  isLoadingMore: boolean
  loadFailed: boolean
  loadMoreFailed: boolean
  nextCursor: string | null
  isSaving: boolean
  syncStatus: SyncStatus
  storageMode: WorkspaceStorageMode
  onActivateWorkspace: (workspaceId: string) => void
  onEditWorkspace: (workspaceId: string) => void
  onLoadMore: () => void
  onCreateWorkspace: () => void
  onNavigateOverview: () => void
  onNavigateClients: () => void
  onNavigateTickets: () => void
  activeView: 'overview' | 'clients' | 'tickets'
  onOpenSettings: () => void
  onSignOut?: () => void
}

function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  isLoading,
  isLoadingMore,
  loadFailed,
  loadMoreFailed,
  nextCursor,
  isSaving,
  onActivateWorkspace,
  onEditWorkspace,
  onLoadMore,
  onCreateWorkspace,
}: Pick<
  WorkspaceSidebarProps,
  | 'workspaces'
  | 'activeWorkspaceId'
  | 'isLoading'
  | 'isLoadingMore'
  | 'loadFailed'
  | 'loadMoreFailed'
  | 'nextCursor'
  | 'isSaving'
  | 'onActivateWorkspace'
  | 'onEditWorkspace'
  | 'onLoadMore'
  | 'onCreateWorkspace'
>) {
  const { t, language } = useLanguage()
  const { isMobile, setOpenMobile } = useSidebar()
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
  const collator = new Intl.Collator(language, { sensitivity: 'base' })
  const sortedWorkspaces = [...workspaces].sort(
    (left, right) => collator.compare(left.name, right.name) || left.id.localeCompare(right.id),
  )

  if (isLoading || loadFailed || workspaces.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          className="workspace-sidebar-switcher"
          disabled={isSaving}
          title={activeWorkspace?.name ?? t('workspaces', 'chooseWorkspace')}
        >
          {activeWorkspace && (
            <span
              className="workspace-switcher-mark"
              style={{ '--workspace-accent': workspaceAccentColors[activeWorkspace.accentColor] } as CSSProperties}
            >
              <WorkspaceIconGlyph icon={activeWorkspace.icon} size={15} />
            </span>
          )}
          <span className="workspace-switcher-name">{activeWorkspace?.name ?? t('workspaces', 'chooseWorkspace')}</span>
          <ChevronDown className="workspace-switcher-chevron" size={14} aria-hidden="true" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={isMobile ? 'bottom' : 'right'} align="start" className="workspace-menu">
        <div className="workspace-menu-heading">{t('workspaces', 'yourWorkspaces')}</div>
        {sortedWorkspaces.map((workspace) => (
          <div className="workspace-menu-row" key={workspace.id}>
            <DropdownMenuItem className="workspace-menu-workspace" onSelect={() => onActivateWorkspace(workspace.id)}>
              <span className="workspace-menu-option">
                <span
                  className="workspace-menu-mark"
                  style={{ '--workspace-accent': workspaceAccentColors[workspace.accentColor] } as CSSProperties}
                >
                  <WorkspaceIconGlyph icon={workspace.icon} size={14} />
                </span>
                <span className="workspace-menu-name">{workspace.name}</span>
                {workspace.id === activeWorkspaceId && <Check size={14} aria-hidden="true" />}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="workspace-menu-edit"
              aria-label={`${t('workspaces', 'editWorkspace')}: ${workspace.name}`}
              title={`${t('workspaces', 'editWorkspace')}: ${workspace.name}`}
              onSelect={() => {
                onEditWorkspace(workspace.id)
                if (isMobile) setOpenMobile(false)
              }}
            >
              <Pencil size={13} aria-hidden="true" />
            </DropdownMenuItem>
          </div>
        ))}
        {nextCursor !== null && (
          <DropdownMenuItem disabled={isLoadingMore} onSelect={onLoadMore}>
            <span className="workspace-menu-option">
              {isLoadingMore ? (
                <LoaderCircle className="loading-icon" size={14} aria-hidden="true" />
              ) : (
                <Plus size={14} aria-hidden="true" />
              )}
              <span>
                {t('workspaces', isLoadingMore ? 'loadingMore' : loadMoreFailed ? 'loadMoreFailed' : 'loadMore')}
              </span>
            </span>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCreateWorkspace}>
          <span className="workspace-menu-option">
            <Plus size={15} aria-hidden="true" />
            <span>{t('workspaces', 'newWorkspace')}</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PrimaryNavigation({
  onNavigateOverview,
  onNavigateClients,
  onNavigateTickets,
  activeView,
}: Pick<WorkspaceSidebarProps, 'onNavigateOverview' | 'onNavigateClients' | 'onNavigateTickets' | 'activeView'>) {
  const { t } = useLanguage()
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <SidebarGroup>
      <nav aria-label={t('navigation', 'primary')}>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<a href="#overview" aria-current={activeView === 'overview' ? 'page' : undefined} />}
              isActive={activeView === 'overview'}
              aria-label={t('navigation', 'overview')}
              tooltip={t('navigation', 'overview')}
              onClick={() => {
                onNavigateOverview()
                if (isMobile) setOpenMobile(false)
              }}
            >
              <LayoutDashboard className="sidebar-menu-icon" size={16} aria-hidden="true" />
              <span className="sidebar-menu-label">{t('navigation', 'overview')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<a href="#clients" aria-current={activeView === 'clients' ? 'page' : undefined} />}
              isActive={activeView === 'clients'}
              aria-label={t('clients', 'title')}
              tooltip={t('clients', 'title')}
              onClick={() => {
                onNavigateClients()
                if (isMobile) setOpenMobile(false)
              }}
            >
              <Users className="sidebar-menu-icon" size={16} aria-hidden="true" />
              <span className="sidebar-menu-label">{t('clients', 'title')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<a href="#tickets" aria-current={activeView === 'tickets' ? 'page' : undefined} />}
              isActive={activeView === 'tickets'}
              aria-label={t('tickets', 'title')}
              tooltip={t('tickets', 'title')}
              onClick={() => {
                onNavigateTickets()
                if (isMobile) setOpenMobile(false)
              }}
            >
              <Ticket className="sidebar-menu-icon" size={16} aria-hidden="true" />
              <span className="sidebar-menu-label">{t('tickets', 'title')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </nav>
    </SidebarGroup>
  )
}

function UserMenu({
  userName,
  userDetail,
  onSignOut,
  storageMode,
}: Pick<WorkspaceSidebarProps, 'userName' | 'userDetail' | 'onSignOut' | 'storageMode'>) {
  const { t } = useLanguage()
  const { isMobile } = useSidebar()
  const initials = userName.trim().charAt(0).toLocaleUpperCase() || userDetail.charAt(0).toLocaleUpperCase()

  if (storageMode === 'local') {
    return (
      <SidebarMenuButton className="workspace-user-trigger" title={`${userName} · ${userDetail}`}>
        <span className="workspace-user-avatar" aria-hidden="true">
          {initials || <UserRound size={15} />}
        </span>
        <span className="workspace-user-copy">
          <span className="workspace-user-name">{userName}</span>
          <span className="workspace-user-email">{userDetail}</span>
        </span>
      </SidebarMenuButton>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton className="workspace-user-trigger" title={`${userName} · ${userDetail}`}>
          <span className="workspace-user-avatar" aria-hidden="true">
            {initials || <UserRound size={15} />}
          </span>
          <span className="workspace-user-copy">
            <span className="workspace-user-name">{userName}</span>
            <span className="workspace-user-email">{userDetail}</span>
          </span>
          <ChevronDown className="workspace-user-chevron" size={14} aria-hidden="true" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={isMobile ? 'top' : 'right'}
        align={isMobile ? 'end' : 'start'}
        className="workspace-menu"
      >
        {onSignOut && (
          <DropdownMenuItem onSelect={onSignOut}>
            <span className="workspace-menu-option">
              <LogOut size={15} aria-hidden="true" />
              <span>{t('app', 'signOut')}</span>
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const { t } = useLanguage()
  const { isMobile, theme, setOpenMobile } = useSidebar()

  return (
    <TooltipProvider delay={350}>
      <Sidebar theme={theme} mobileTitle={t('navigation', 'primary')}>
        <SidebarHeader className="workspace-sidebar-header">
          <div className="workspace-sidebar-brand-row">
            <a className="workspace-brand" href="#overview" aria-label={t('app', 'home')}>
              <img src="/brand/logo-vesta.svg" alt="" />
              <span>Vesta</span>
            </a>
          </div>
          <WorkspaceSwitcher {...props} />
        </SidebarHeader>

        <SidebarContent>
          <PrimaryNavigation
            onNavigateOverview={props.onNavigateOverview}
            onNavigateClients={props.onNavigateClients}
            onNavigateTickets={props.onNavigateTickets}
            activeView={props.activeView}
          />
        </SidebarContent>

        <SidebarFooter className="workspace-sidebar-footer">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                aria-label={t('navigation', 'settings')}
                tooltip={t('navigation', 'settings')}
                onClick={() => {
                  if (isMobile) setOpenMobile(false)
                  props.onOpenSettings()
                }}
              >
                <Settings2 className="sidebar-menu-icon" size={16} aria-hidden="true" />
                <span className="sidebar-menu-label">{t('navigation', 'settings')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <UserMenu
                userName={props.userName}
                userDetail={props.userDetail}
                onSignOut={props.onSignOut}
                storageMode={props.storageMode}
              />
            </SidebarMenuItem>
          </SidebarMenu>
          {(props.storageMode === 'local' || props.syncStatus !== 'idle') && (
            <span
              className={`workspace-sync-status is-${props.syncStatus}`}
              role={props.syncStatus === 'error' ? 'alert' : 'status'}
            >
              <span className={`workspace-sync-dot is-${props.syncStatus}`} aria-hidden="true" />
              {props.storageMode === 'local'
                ? t('workspaces', 'savedLocally')
                : t(
                    'workspaces',
                    props.syncStatus === 'syncing'
                      ? 'syncing'
                      : props.syncStatus === 'error'
                        ? 'syncError'
                        : 'savedLocally',
                  )}
              {props.storageMode === 'server' && props.syncStatus === 'pending' && (
                <span> v{import.meta.env.VITE_APP_VERSION}</span>
              )}
            </span>
          )}
        </SidebarFooter>
      </Sidebar>
    </TooltipProvider>
  )
}
