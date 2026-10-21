import { useState, type FormEvent } from 'react'
import { Button } from '../../../components/ui/button'
import { Checkbox } from '../../../components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { useLanguage } from '../../localization/language-context'
import { createClientSchema, type Client } from '../../../../packages/clients/src/contract'
import type { Theme } from '../../preferences/theme-preference'

type ClientValues = { code: string; name: string; active: boolean }

type ClientFormDialogProps = {
  open: boolean
  client: Client | null
  theme: Theme
  isSaving: boolean
  codeConflict: boolean
  saveFailed: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (values: ClientValues) => Promise<boolean>
  onUpdate: (clientId: string, values: ClientValues) => Promise<boolean>
}

export function ClientFormDialog({
  open,
  client,
  theme,
  isSaving,
  codeConflict,
  saveFailed,
  onOpenChange,
  onCreate,
  onUpdate,
}: ClientFormDialogProps) {
  const { t } = useLanguage()
  const [code, setCode] = useState(client?.code ?? '')
  const [name, setName] = useState(client?.name ?? '')
  const [active, setActive] = useState(client?.active ?? true)
  const [fieldError, setFieldError] = useState<'code' | 'name' | null>(null)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFieldError(null)
    const parsed = createClientSchema.safeParse({ code, name, active })
    if (!parsed.success) {
      const invalidField = parsed.error.issues.some((issue) => issue.path[0] === 'code') ? 'code' : 'name'
      setFieldError(invalidField)
      return
    }

    const saved = client ? await onUpdate(client.id, parsed.data) : await onCreate(parsed.data)
    if (saved) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`client-dialog${theme === 'dark' ? ' theme-dark' : ''}`}
        aria-describedby="client-dialog-description"
      >
        <DialogHeader className="client-dialog-header">
          <DialogTitle>{t('clients', client ? 'editTitle' : 'createTitle')}</DialogTitle>
          <DialogDescription id="client-dialog-description">
            {t('clients', client ? 'editDescription' : 'createDescription')}
          </DialogDescription>
        </DialogHeader>
        <form className="client-dialog-form" onSubmit={(event) => void save(event)}>
          <div className="client-form-field">
            <label htmlFor="client-code">{t('clients', 'code')}</label>
            <Input
              id="client-code"
              name="code"
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
              autoFocus
              autoComplete="off"
              maxLength={64}
              required
              aria-invalid={fieldError === 'code'}
              aria-describedby={fieldError === 'code' ? 'client-code-error' : undefined}
            />
            {fieldError === 'code' && (
              <span className="client-form-error" id="client-code-error">
                {t('clients', 'codeRequired')}
              </span>
            )}
          </div>
          <div className="client-form-field">
            <label htmlFor="client-name">{t('clients', 'name')}</label>
            <Input
              id="client-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              autoComplete="organization"
              maxLength={120}
              required
              aria-invalid={fieldError === 'name'}
              aria-describedby={fieldError === 'name' ? 'client-name-error' : undefined}
            />
            {fieldError === 'name' && (
              <span className="client-form-error" id="client-name-error">
                {t('clients', 'nameRequired')}
              </span>
            )}
          </div>
          <label className="client-active-field">
            <Checkbox checked={active} onCheckedChange={setActive} name="active" />
            <span>{t('clients', 'active')}</span>
          </label>
          {codeConflict && (
            <p className="client-dialog-error" role="alert">
              {t('clients', 'codeInUse')}
            </p>
          )}
          {saveFailed && (
            <p className="client-dialog-error" role="alert">
              {t('clients', 'saveFailed')}
            </p>
          )}
          <div className="client-dialog-footer">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
              {t('clients', 'cancel')}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {t('clients', isSaving ? 'saving' : 'save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
