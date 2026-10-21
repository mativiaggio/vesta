import { useState, type CSSProperties, type FormEvent } from 'react'
import { LoaderCircle, Palette, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '../../../components/ui/sidebar'
import { useLanguage } from '../../localization/language-context'
import type { Theme } from '../../preferences/theme-preference'
import {
  createWorkspaceSchema,
  type Workspace,
  type WorkspaceAccent,
  type WorkspaceIcon,
  type UpdateWorkspaceMutation,
  type DeleteWorkspaceMutation,
} from '../../../../packages/workspaces/src/contract'
import { WorkspaceAppearanceFields } from './workspace-appearance-fields'
import { WorkspaceIconGlyph } from './workspace-icon'
import { workspaceAccentColors } from './workspace-theme'

type WorkspaceSettingsSection = 'general' | 'appearance' | 'danger'

type WorkspaceSettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: Workspace | null
  theme: Theme
  isSaving: boolean
  onSave: (workspaceId: string, input: Omit<UpdateWorkspaceMutation, 'clientMutationId'>) => Promise<boolean>
  onDelete: (workspaceId: string, input: Omit<DeleteWorkspaceMutation, 'clientMutationId'>) => Promise<boolean>
}

export function WorkspaceSettingsDialog({
  open,
  onOpenChange,
  workspace,
  theme,
  isSaving,
  onSave,
  onDelete,
}: WorkspaceSettingsDialogProps) {
  const { t } = useLanguage()
  const [initialWorkspace] = useState(workspace)
  const [section, setSection] = useState<WorkspaceSettingsSection>('general')
  const [name, setName] = useState(workspace?.name ?? '')
  const [accentColor, setAccentColor] = useState<WorkspaceAccent>(workspace?.accentColor ?? 'olive')
  const [icon, setIcon] = useState<WorkspaceIcon>(workspace?.icon ?? 'briefcase')
  const [confirmationName, setConfirmationName] = useState('')
  const [nameError, setNameError] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [deleteError, setDeleteError] = useState(false)

  if (!workspace) return null

  const workspaceName = workspace.name
  const baselineWorkspace = initialWorkspace ?? workspace
  const workspaceId = baselineWorkspace.id
  const isDirty =
    name.trim() !== baselineWorkspace.name ||
    accentColor !== baselineWorkspace.accentColor ||
    icon !== baselineWorkspace.icon

  async function saveWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNameError(false)
    setSaveError(false)

    const parsedInput = createWorkspaceSchema.safeParse({ name, accentColor, icon })
    if (!parsedInput.success) {
      setSection('general')
      setNameError(true)
      return
    }

    const changes: Omit<UpdateWorkspaceMutation, 'clientMutationId'> = {}
    if (parsedInput.data.name !== baselineWorkspace.name) changes.name = parsedInput.data.name
    if (parsedInput.data.accentColor !== baselineWorkspace.accentColor)
      changes.accentColor = parsedInput.data.accentColor
    if (parsedInput.data.icon !== baselineWorkspace.icon) changes.icon = parsedInput.data.icon

    if (await onSave(workspaceId, changes)) onOpenChange(false)
    else setSaveError(true)
  }

  async function deleteWorkspace() {
    if (confirmationName !== workspaceName) return
    setDeleteError(false)
    if (await onDelete(workspaceId, { confirmationName })) onOpenChange(false)
    else setDeleteError(true)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`settings-dialog workspace-settings-dialog theme-${theme}`}>
        <DialogHeader className="settings-dialog-header">
          <div className="workspace-settings-title-copy">
            <DialogTitle>
              {t('workspaces', 'editWorkspace')}: <span>{workspace.name}</span>
            </DialogTitle>
            <DialogDescription>{t('workspaces', 'workspaceSettingsDescription')}</DialogDescription>
          </div>
          <DialogClose className="settings-dialog-close" aria-label={t('settings', 'close')}>
            <X size={16} aria-hidden="true" />
          </DialogClose>
        </DialogHeader>

        <div className="settings-dialog-body">
          <nav className="settings-sidebar" aria-label={t('settings', 'sections')}>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton type="button" isActive={section === 'general'} onClick={() => setSection('general')}>
                  <SlidersHorizontal size={15} aria-hidden="true" />
                  <span>{t('settings', 'general')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  isActive={section === 'appearance'}
                  onClick={() => setSection('appearance')}
                >
                  <Palette size={15} aria-hidden="true" />
                  <span>{t('settings', 'appearance')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="workspace-settings-danger-button"
                  type="button"
                  isActive={section === 'danger'}
                  onClick={() => setSection('danger')}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  <span>{t('workspaces', 'danger')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </nav>

          <div className="settings-panel workspace-settings-panel">
            {section === 'danger' ? (
              <section
                className="workspace-settings-form workspace-settings-danger"
                aria-labelledby="workspace-danger-title"
              >
                <div>
                  <div className="settings-section-heading">
                    <h2 id="workspace-danger-title">{t('workspaces', 'workspaceDangerTitle')}</h2>
                    <p>{t('workspaces', 'workspaceDangerDescription')}</p>
                  </div>
                  <div className="workspace-settings-danger-challenge">
                    <p>{t('workspaces', 'deleteWorkspaceConfirmationPrompt')}</p>
                    <p className="workspace-settings-danger-name">{workspace.name}</p>
                    <div className="workspace-settings-field">
                      <label htmlFor="workspace-delete-confirmation">{t('workspaces', 'confirmWorkspaceName')}</label>
                      <Input
                        id="workspace-delete-confirmation"
                        name="confirmationName"
                        autoComplete="off"
                        value={confirmationName}
                        onChange={(event) => {
                          setConfirmationName(event.currentTarget.value)
                          setDeleteError(false)
                        }}
                      />
                    </div>
                  </div>
                </div>
                {deleteError && (
                  <p className="workspace-settings-error" role="alert">
                    {t('workspaces', 'deleteWorkspaceFailed')}
                  </p>
                )}
                <div className="workspace-settings-footer">
                  <Button
                    className="workspace-danger-delete-action"
                    type="button"
                    disabled={isSaving || confirmationName !== workspace.name}
                    onClick={() => void deleteWorkspace()}
                  >
                    {isSaving && <LoaderCircle className="loading-icon" size={15} aria-hidden="true" />}
                    {t('workspaces', isSaving ? 'deletingWorkspace' : 'deleteWorkspace')}
                  </Button>
                </div>
              </section>
            ) : (
              <form className="workspace-settings-form" onSubmit={(event) => void saveWorkspace(event)}>
                {section === 'general' ? (
                  <section aria-labelledby="workspace-settings-general-title">
                    <div className="settings-section-heading">
                      <h2 id="workspace-settings-general-title">{t('settings', 'general')}</h2>
                      <p>{t('workspaces', 'workspaceGeneralDescription')}</p>
                    </div>
                    <div className="workspace-settings-field">
                      <label htmlFor="workspace-settings-name">{t('workspaces', 'workspaceName')}</label>
                      <Input
                        id="workspace-settings-name"
                        name="name"
                        required
                        autoComplete="off"
                        maxLength={48}
                        value={name}
                        aria-invalid={nameError}
                        aria-describedby={nameError ? 'workspace-settings-name-error' : undefined}
                        onChange={(event) => {
                          setName(event.currentTarget.value)
                          setNameError(false)
                        }}
                      />
                      {nameError && (
                        <span className="workspace-settings-field-error" id="workspace-settings-name-error">
                          {t('workspaces', 'nameRequired')}
                        </span>
                      )}
                    </div>
                  </section>
                ) : (
                  <section
                    className="workspace-settings-appearance"
                    aria-labelledby="workspace-settings-appearance-title"
                  >
                    <div className="settings-section-heading">
                      <h2 id="workspace-settings-appearance-title">{t('settings', 'appearance')}</h2>
                      <p>{t('workspaces', 'workspaceAppearanceDescription')}</p>
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
                      <span className="workspace-preview-name">
                        {name.trim() || t('workspaces', 'namePlaceholder')}
                      </span>
                      <span className="workspace-preview-caption">{t('workspaces', 'workspaceLabel')}</span>
                    </div>
                  </section>
                )}

                {saveError && (
                  <p className="workspace-settings-error" role="alert">
                    {t('workspaces', 'workspaceUpdateFailed')}
                  </p>
                )}
                <div className="workspace-settings-footer">
                  <Button type="submit" disabled={isSaving || !isDirty}>
                    {isSaving && <LoaderCircle className="loading-icon" size={15} aria-hidden="true" />}
                    {t('workspaces', isSaving ? 'savingChanges' : 'saveChanges')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
