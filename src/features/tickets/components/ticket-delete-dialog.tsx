import { Button } from '../../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { useLanguage } from '../../localization/language-context'
import type { Ticket } from '../../../../packages/tickets/src/contract'
import type { Theme } from '../../preferences/theme-preference'

type TicketDeleteDialogProps = {
  ticket: Ticket | null
  theme: Theme
  isSaving: boolean
  saveFailed: boolean
  onOpenChange: (open: boolean) => void
  onDelete: (ticketId: string) => Promise<boolean>
}

export function TicketDeleteDialog({
  ticket,
  theme,
  isSaving,
  saveFailed,
  onOpenChange,
  onDelete,
}: TicketDeleteDialogProps) {
  const { t } = useLanguage()

  async function confirmDelete() {
    if (!ticket) return
    if (await onDelete(ticket.id)) onOpenChange(false)
  }

  return (
    <Dialog open={ticket !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className={`ticket-delete-dialog${theme === 'dark' ? ' theme-dark' : ''}`}
        aria-describedby="ticket-delete-description"
      >
        <DialogHeader>
          <DialogTitle>{t('tickets', 'deleteTitle')}</DialogTitle>
          <DialogDescription id="ticket-delete-description">{t('tickets', 'deleteDescription')}</DialogDescription>
        </DialogHeader>
        {saveFailed && (
          <p className="ticket-dialog-error" role="alert">
            {t('tickets', 'deleteFailed')}
          </p>
        )}
        <div className="ticket-dialog-footer">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t('tickets', 'cancel')}
          </Button>
          <Button
            type="button"
            variant="default"
            className="ticket-destructive-button"
            onClick={() => void confirmDelete()}
            disabled={isSaving}
          >
            {t('tickets', isSaving ? 'deleting' : 'delete')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
