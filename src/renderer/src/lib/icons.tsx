// Semantic icon set (design doc 10): Lucide is the single icon family.
// Components import by role name from here, never from lucide-react directly,
// so a package swap or a glyph change stays a one-file edit. Icons inherit
// currentColor; pass aria-hidden when a visible label already names the
// control. Sizes per design doc 10: compact controls 14, status 13-14,
// inline micro controls 12.
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Code,
  Container,
  Database,
  ExternalLink,
  Eye,
  FastForward,
  File,
  Files,
  FlaskConical,
  Folder,
  FolderOpen,
  FolderPlus,
  Forward,
  GitBranch,
  Globe,
  Hammer,
  LayoutGrid,
  List,
  LoaderCircle,
  type LucideIcon,
  MessageSquare,
  Mic,
  Package,
  PanelLeft,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Send,
  Settings,
  Square,
  SquareKanban,
  SquareTerminal,
  X,
  Zap,
} from 'lucide-react'

export const Icon = {
  agent: Bot,
  back: ArrowLeft,
  board: LayoutGrid,
  build: Hammer,
  chat: MessageSquare,
  check: CircleCheck,
  checkSmall: Check,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  close: X,
  code: Code,
  container: Container,
  continue: FastForward,
  database: Database,
  dictation: Mic,
  directory: FolderOpen,
  external: ExternalLink,
  fail: CircleX,
  file: File,
  files: Files,
  git: GitBranch,
  globe: Globe,
  handoff: Forward,
  kanban: SquareKanban,
  list: List,
  panelLeft: PanelLeft,
  panelRight: PanelRight,
  bug: Bug,
  deploy: Rocket,
  package: Package,
  plus: Plus,
  preview: Eye,
  projects: Folder,
  projectAdd: FolderPlus,
  retry: RefreshCw,
  resume: Play,
  run: Play,
  running: LoaderCircle,
  search: Search,
  send: Send,
  settings: Settings,
  sortAsc: ArrowUp,
  sortDesc: ArrowDown,
  stop: Square,
  terminal: SquareTerminal,
  test: FlaskConical,
  timer: Zap,
  web: Globe,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof Icon
export type { LucideIcon }

/**
 * Preset glyphs offered by the Action Settings icon picker (center-layout-
 * tabs-actions spec Behaviour 8): each entry is an Icon key, so the palette
 * can only grow with the semantic set. ACTION_NONE keeps "no icon" as an
 * explicit picker choice.
 */
export const ACTION_ICON_NAMES = [
  'run',
  'stop',
  'preview',
  'continue',
  'retry',
  'build',
  'test',
  'bug',
  'deploy',
  'web',
  'terminal',
  'database',
  'package',
  'timer',
] as const satisfies ReadonlyArray<IconName>

export const ACTION_NONE: 'none' = 'none'

/** Resolve a stored icon value: a palette name renders as a Lucide glyph. */
export function actionIconGlyph(value: string | null): LucideIcon | null {
  if (value === null) return null
  if ((ACTION_ICON_NAMES as readonly string[]).includes(value)) {
    return Icon[value as IconName]
  }
  return null
}
