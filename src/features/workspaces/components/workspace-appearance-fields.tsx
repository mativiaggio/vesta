import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { useLanguage } from '../../localization/language-context'
import {
  workspaceAccents,
  workspaceIcons,
  type WorkspaceAccent,
  type WorkspaceIcon,
} from '../../../../packages/workspaces/src/contract'
import { WorkspaceIconGlyph } from './workspace-icon'
import { workspaceAccentColors } from './workspace-theme'

type WorkspaceAppearanceFieldsProps = {
  accentColor: WorkspaceAccent
  icon: WorkspaceIcon
  onAccentColorChange: (color: WorkspaceAccent) => void
  onIconChange: (icon: WorkspaceIcon) => void
}

export function WorkspaceAppearanceFields({
  accentColor,
  icon,
  onAccentColorChange,
  onIconChange,
}: WorkspaceAppearanceFieldsProps) {
  const { t } = useLanguage()

  return (
    <>
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
              onClick={() => onAccentColorChange(color)}
            >
              <span style={{ backgroundColor: workspaceAccentColors[color] }} />
              {accentColor === color && <Check size={13} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset
        className="workspace-choice-group workspace-icon-group"
        style={{ '--workspace-accent': workspaceAccentColors[accentColor] } as CSSProperties}
      >
        <legend>{t('workspaces', 'identifyWith')}</legend>
        <div className="workspace-icon-options">
          {workspaceIcons.map((iconOption) => (
            <button
              key={iconOption}
              className={`workspace-icon-option${icon === iconOption ? ' is-selected' : ''}`}
              type="button"
              aria-label={t('workspaces', iconOption)}
              aria-pressed={icon === iconOption}
              title={t('workspaces', iconOption)}
              onClick={() => onIconChange(iconOption)}
            >
              <WorkspaceIconGlyph icon={iconOption} size={18} />
            </button>
          ))}
        </div>
      </fieldset>
    </>
  )
}
