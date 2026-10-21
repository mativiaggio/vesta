import {
  BookOpen,
  Briefcase,
  Building2,
  Camera,
  ChartNoAxesCombined,
  Code2,
  Folder,
  Laptop,
  Layers,
  NotebookPen,
  Palette,
  PenTool,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import type { WorkspaceIcon } from '../../../../packages/workspaces/src/contract'

const workspaceIconComponents = {
  briefcase: Briefcase,
  folder: Folder,
  layers: Layers,
  'notebook-pen': NotebookPen,
  laptop: Laptop,
  palette: Palette,
  'building-2': Building2,
  'book-open': BookOpen,
  'code-2': Code2,
  'chart-no-axes-combined': ChartNoAxesCombined,
  camera: Camera,
  'pen-tool': PenTool,
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
