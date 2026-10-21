import { Button } from '../../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { useLanguage } from '../../localization/language-context'
import type { Client } from '../../../../packages/clients/src/contract'
import type { Theme } from '../../preferences/theme-preference'

type ClientDeleteDialogProps = {
  client: Client | null
  theme: Theme
  isSaving: boolean
  saveFailed: boolean
  onOpenChange: (open: boolean) => void
  onDelete: (clientId: string) => Promise<boolean>
}

export function ClientDeleteDialog({
  client,
  theme,
  isSaving,
  saveFailed,
  onOpenChange,
  onDelete,
}: ClientDeleteDialogProps) {
  const { t } = useLanguage()

  async function confirmDelete() {
    if (client && (await onDelete(client.id))) onOpenChange(false)
  }

  return (
    <Dialog open={client !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className={`client-dialog${theme === 'dark' ? ' theme-dark' : ''}`}
        aria-describedby="client-delete-description"
      >
        <DialogHeader className="client-dialog-header">
          <DialogTitle>{t('clients', 'deleteTitle')}</DialogTitle>
          <DialogDescription id="client-delete-description">{t('clients', 'deleteDescription')}</DialogDescription>
        </DialogHeader>
        {client && (
          <p className="client-delete-name">
            {client.name} <span>({client.code})</span>
          </p>
        )}
        {saveFailed && (
          <p className="client-dialog-error" role="alert">
            {t('clients', 'deleteFailed')}
          </p>
        )}
        <div className="client-dialog-footer">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t('clients', 'cancel')}
          </Button>
          <Button
            type="button"
            className="client-delete-action"
            onClick={() => void confirmDelete()}
            disabled={isSaving || client === null}
          >
            {t('clients', isSaving ? 'deleting' : 'delete')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
