import type React from 'react'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'
import type { MarkdownViewMode } from './markdown-path'

// Code | Preview switch for a Markdown file, shared by the main window action
// bar and the file preview window title strip.
export function MarkdownViewToggle({
  mode,
  onChange,
  className,
}: {
  mode: MarkdownViewMode
  onChange: (mode: MarkdownViewMode) => void
  className?: string
}): React.JSX.Element {
  return (
    <fieldset className={cn('nk-btn-group shrink-0', className)}>
      <legend className="sr-only">Markdown view</legend>
      <button
        type="button"
        className={cn('nk-tb', mode === 'code' && 'active')}
        aria-pressed={mode === 'code'}
        data-testid={TEST_ID.fileMarkdownCode}
        onClick={() => {
          onChange('code')
        }}
      >
        <Icon.code
          size={15}
          aria-hidden
          className={mode === 'code' ? 'text-ink' : 'text-ink-secondary'}
        />
        Code
      </button>
      <span aria-hidden="true" className="h-4 w-px bg-edge" />
      <button
        type="button"
        className={cn('nk-tb', mode === 'preview' && 'active')}
        aria-pressed={mode === 'preview'}
        data-testid={TEST_ID.fileMarkdownPreview}
        onClick={() => {
          onChange('preview')
        }}
      >
        <Icon.preview
          size={15}
          aria-hidden
          className={mode === 'preview' ? 'text-ink' : 'text-ink-secondary'}
        />
        Preview
      </button>
    </fieldset>
  )
}
