import { useRef } from 'react'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'

export function KanbanSearch({
  query,
  onQueryChange,
  disabled = false,
}: {
  query: string
  onQueryChange: (query: string) => void
  disabled?: boolean
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex h-[30px] items-center gap-2 px-2.5">
      <Icon.search size={14} aria-hidden className="shrink-0 text-ink-muted" />
      <input
        ref={inputRef}
        type="text"
        aria-label="Search titles"
        placeholder="Search titles..."
        value={query}
        disabled={disabled}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onQueryChange('')
          }
        }}
        data-testid={TEST_ID.kanbanSearchInput}
        className="w-48 bg-transparent text-sm text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-50"
      />
      {query !== '' ? (
        <button
          type="button"
          aria-label="Clear search"
          disabled={disabled}
          className="flex size-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-highlight hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
          onClick={() => {
            onQueryChange('')
            inputRef.current?.focus()
          }}
        >
          <Icon.close size={14} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
