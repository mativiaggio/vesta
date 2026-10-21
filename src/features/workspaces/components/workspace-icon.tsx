import { Briefcase, Folder, Laptop, Layers, NotebookPen, Palette } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { WorkspaceIcon } from '../../../../packages/workspaces/src/contract'

const workspaceIconComponents = {
  briefcase: Briefcase,
  folder: Folder,
  layers: Layers,
  'notebook-pen': NotebookPen,
  laptop: Laptop,
  palette: Palette,
} satisfies Record<WorkspaceIcon, typeof Briefcase>

export function WorkspaceIconGlyph({
  icon,
  size = 16,
  className,
  style,
}: {
  icon: WorkspaceIcon
  size?: number
  className?: string
  style?: CSSProperties
}) {
  const IconComponent = workspaceIconComponents[icon]
  return <IconComponent className={className} size={size} style={style} aria-hidden="true" />
}
