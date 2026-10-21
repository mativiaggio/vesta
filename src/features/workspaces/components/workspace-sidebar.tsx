import type { CSSProperties } from 'react'
import { Check, ChevronDown, LayoutDashboard, LoaderCircle, LogOut, Plus, Settings2, UserRound } from 'lucide-react'
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
import { useLanguage } from '../../localization/language-context'
import { LanguageSelector } from '../../localization/components/language-selector'
import type { useWorkspaceState } from '../application/use-workspace-state'
import { WorkspaceIconGlyph } from './workspace-icon'
import { workspaceAccentColors } from './workspace-theme'

type Workspace = ReturnType<typeof useWorkspaceState>['workspaces'][number]
type SyncStatus = ReturnType<typeof useWorkspaceState>['syncStatus']

type WorkspaceSidebarProps = {
  userName: string
  userEmail: string
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  isLoading: boolean
  isLoadingMore: boolean
  loadFailed: boolean
  loadMoreFailed: boolean
  nextCursor: string | null
  isSaving: boolean
  syncStatus: SyncStatus
  onActivateWorkspace: (workspaceId: string) => void
  onLoadMore: () => void
  onCreateWorkspace: () => void
  onNavigateOverview: () => void
  onSignOut: () => void
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
  | 'onLoadMore'
  | 'onCreateWorkspace'
>) {
  const { t } = useLanguage()
  const { isMobile } = useSidebar()
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null

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
        {workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.id} onSelect={() => onActivateWorkspace(workspace.id)}>
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

function PrimaryNavigation({ onNavigateOverview }: Pick<WorkspaceSidebarProps, 'onNavigateOverview'>) {
  const { t } = useLanguage()
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <SidebarGroup>
      <nav aria-label={t('navigation', 'primary')}>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<a href="#overview" aria-current="page" />}
              isActive
              title={t('navigation', 'overview')}
              onClick={() => {
                onNavigateOverview()
                if (isMobile) setOpenMobile(false)
              }}
            >
              <LayoutDashboard className="sidebar-menu-icon" size={16} aria-hidden="true" />
              <span className="sidebar-menu-label">{t('navigation', 'overview')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </nav>
    </SidebarGroup>
  )
}

function UserMenu({
  userName,
  userEmail,
  onSignOut,
}: Pick<WorkspaceSidebarProps, 'userName' | 'userEmail' | 'onSignOut'>) {
  const { t } = useLanguage()
  const { isMobile } = useSidebar()
  const initials = userName.trim().charAt(0).toLocaleUpperCase() || userEmail.charAt(0).toLocaleUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton className="workspace-user-trigger" title={`${userName} · ${userEmail}`}>
          <span className="workspace-user-avatar" aria-hidden="true">
            {initials || <UserRound size={15} />}
          </span>
          <span className="workspace-user-copy">
            <span className="workspace-user-name">{userName}</span>
            <span className="workspace-user-email">{userEmail}</span>
          </span>
          <ChevronDown className="workspace-user-chevron" size={14} aria-hidden="true" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={isMobile ? 'top' : 'right'}
        align={isMobile ? 'end' : 'start'}
        className="workspace-menu"
      >
        <DropdownMenuItem onSelect={onSignOut}>
          <span className="workspace-menu-option">
            <LogOut size={15} aria-hidden="true" />
            <span>{t('app', 'signOut')}</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const { t } = useLanguage()
  const { isMobile, theme } = useSidebar()

  return (
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
        <PrimaryNavigation onNavigateOverview={props.onNavigateOverview} />
      </SidebarContent>

      <SidebarFooter className="workspace-sidebar-footer">
        {props.syncStatus !== 'idle' && (
          <span
            className={`workspace-sync-status is-${props.syncStatus}`}
            role={props.syncStatus === 'error' ? 'alert' : 'status'}
          >
            <span className={`workspace-sync-dot is-${props.syncStatus}`} aria-hidden="true" />
            {t(
              'workspaces',
              props.syncStatus === 'syncing' ? 'syncing' : props.syncStatus === 'error' ? 'syncError' : 'savedLocally',
            )}
          </span>
        )}
        <LanguageSelector side={isMobile ? 'bottom' : 'right'} align={isMobile ? 'end' : 'start'} />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton disabled title={t('navigation', 'settings')}>
              <Settings2 className="sidebar-menu-icon" size={16} aria-hidden="true" />
              <span className="sidebar-menu-label">{t('navigation', 'settings')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <UserMenu userName={props.userName} userEmail={props.userEmail} onSignOut={props.onSignOut} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
