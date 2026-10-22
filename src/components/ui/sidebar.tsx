import * as React from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from './button'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'
import { SidebarContext, sidebarToggleEvent, type SidebarContextValue, useSidebar } from './sidebar-context'

type SidebarProviderProps = React.ComponentProps<'div'> & {
  theme?: 'light' | 'dark'
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SidebarProvider({
  theme = 'light',
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  className,
  style,
  children,
  ...props
}: SidebarProviderProps) {
  const [isMobile, setIsMobile] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  )
  const [openMobile, setOpenMobile] = React.useState(false)
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const open = openProp ?? uncontrolledOpen

  React.useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const updateMobileState = () => setIsMobile(mediaQuery.matches)
    mediaQuery.addEventListener('change', updateMobileState)
    updateMobileState()
    return () => mediaQuery.removeEventListener('change', updateMobileState)
  }, [])

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (openProp === undefined) setUncontrolledOpen(nextOpen)
      onOpenChange?.(nextOpen)
    },
    [onOpenChange, openProp],
  )
  const toggleSidebar = React.useCallback(() => {
    if (isMobile) setOpenMobile((current) => !current)
    else setOpen(!open)
  }, [isMobile, open, setOpen])
  const state: SidebarContextValue['state'] = open ? 'expanded' : 'collapsed'

  React.useEffect(() => {
    window.addEventListener(sidebarToggleEvent, toggleSidebar)
    return () => window.removeEventListener(sidebarToggleEvent, toggleSidebar)
  }, [toggleSidebar])

  React.useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [toggleSidebar])

  const contextValue = React.useMemo(
    () => ({ theme, state, open, setOpen, openMobile, setOpenMobile, isMobile, toggleSidebar }),
    [theme, state, open, setOpen, openMobile, isMobile, toggleSidebar],
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        className={cn('sidebar-provider', className)}
        style={
          {
            '--sidebar-width': '256px',
            '--sidebar-width-icon': '58px',
            ...style,
          } as React.CSSProperties
        }
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

export function Sidebar({
  className,
  children,
  mobileTitle,
  theme,
  ...props
}: React.ComponentProps<'aside'> & { mobileTitle: string; theme: 'light' | 'dark' }) {
  const { state, openMobile, setOpenMobile } = useSidebar()
  const themeClass = `theme-${theme}`

  return (
    <>
      <aside
        data-slot="sidebar"
        data-state={state}
        data-collapsible={state === 'collapsed' ? 'icon' : ''}
        className={cn('workspace-sidebar', themeClass, className)}
        {...props}
      >
        {children}
      </aside>
      <Dialog.Root open={openMobile} onOpenChange={setOpenMobile}>
        <Dialog.Portal>
          <Dialog.Backdrop className="workspace-sidebar-backdrop" />
          <Dialog.Popup className={cn('workspace-sidebar', 'workspace-sidebar-mobile', themeClass, className)}>
            <Dialog.Title className="visually-hidden">{mobileTitle}</Dialog.Title>
            {children}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

export function SidebarTrigger({
  className,
  onClick,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { 'aria-label': string }) {
  const { state, isMobile, openMobile, toggleSidebar } = useSidebar()
  const isOpen = isMobile ? openMobile : state === 'expanded'

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('sidebar-trigger', className)}
      aria-keyshortcuts="Control+B Meta+B"
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      {children ??
        (isOpen ? <PanelLeftClose size={16} aria-hidden="true" /> : <PanelLeftOpen size={16} aria-hidden="true" />)}
    </Button>
  )
}

export function SidebarInset({ className, ...props }: React.ComponentProps<'main'>) {
  return <main data-slot="sidebar-inset" className={cn('sidebar-inset', className)} {...props} />
}

export function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" className={cn('sidebar-header', className)} {...props} />
}

export function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" className={cn('sidebar-footer', className)} {...props} />
}

export function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-content" className={cn('sidebar-content', className)} {...props} />
}

export function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group" className={cn('sidebar-group', className)} {...props} />
}

export function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu" className={cn('sidebar-menu', className)} {...props} />
}

export function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('sidebar-menu-item', className)} {...props} />
}

const sidebarMenuButtonVariants = cva('sidebar-menu-button', {
  variants: {
    variant: { default: '', outline: 'is-outline' },
    size: { default: '', sm: 'is-small', lg: 'is-large' },
    active: { true: 'is-active', false: '' },
  },
  defaultVariants: { variant: 'default', size: 'default', active: false },
})

export function SidebarMenuButton({
  render,
  isActive = false,
  variant,
  size,
  className,
  tooltip,
  ...props
}: useRender.ComponentProps<'button'> &
  React.ComponentProps<'button'> & {
    isActive?: boolean
    tooltip?: React.ReactNode
  } & VariantProps<typeof sidebarMenuButtonVariants>) {
  const { state, isMobile } = useSidebar()
  const menuButton = useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(
      {
        className: cn(sidebarMenuButtonVariants({ variant, size, active: isActive }), className),
      },
      props,
    ),
    render,
    state: { slot: 'sidebar-menu-button', active: isActive, size },
  })

  if (!tooltip || isMobile || state !== 'collapsed') return menuButton

  return (
    <Tooltip>
      <TooltipTrigger render={menuButton} />
      <TooltipContent side="right" sideOffset={14}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
