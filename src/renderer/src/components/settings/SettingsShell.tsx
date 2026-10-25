import type React from 'react'
import { useEffect, useRef } from 'react'
import { cn } from '../../lib/cn'
import { Icon, type LucideIcon } from '../../lib/icons'
import { focusRing, NavIcon } from './settings-ui'

export interface SettingsNavItem {
  id: string
  label: string
  icon: LucideIcon
  testId?: string
  tabDomId: string
  panelDomId: string
}

interface SettingsShellProps {
  /** Accessible name when the dialog is not named by a heading. */
  ariaLabel?: string
  /** Id of the visually hidden heading that names the dialog. */
  labelledBy?: string
  /** Text of that heading. Also rendered for tests that look up the dialog name. */
  screenReaderTitle?: string
  leading: React.ReactNode
  title: string
  titleNote?: string
  pageLabel: string
  closeLabel: string
  items: SettingsNavItem[]
  activeId: string
  onSelect: (id: string) => void
  onClose: () => void
  /** Hide the dialog without unmounting it (project settings under app settings). */
  suspended?: boolean
  /**
   * `dialog` traps Tab and closes on Escape from the dialog (app settings).
   * `window` closes on Escape from a window listener (project settings), so a
   * nested dialog can stop the event before it arrives.
   */
  keyboard: 'dialog' | 'window'
  dialogRef?: React.Ref<HTMLElement>
  error?: React.ReactNode
  children: React.ReactNode
}

export function SettingsShell({
  ariaLabel,
  labelledBy,
  screenReaderTitle,
  leading,
  title,
  titleNote,
  pageLabel,
  closeLabel,
  items,
  activeId,
  onSelect,
  onClose,
  suspended = false,
  keyboard,
  dialogRef,
  error,
  children,
}: SettingsShellProps): React.JSX.Element {
  const ownRef = useRef<HTMLElement>(null)
  const sectionRef = dialogRef ?? ownRef

  useEffect(() => {
    if (keyboard !== 'window' || suspended) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [keyboard, onClose, suspended])

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (keyboard !== 'dialog') return
    const { key } = event
    if (key === 'Escape') {
      event.stopPropagation()
      onClose()
    } else if (key === 'Tab') {
      event.preventDefault()
      const node = 'current' in sectionRef ? sectionRef.current : null
      const controls = Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
        ) ?? [],
      ).filter((control) => control.tabIndex >= 0)
      const index = controls.indexOf(document.activeElement as HTMLElement)
      const next =
        index < 0
          ? event.shiftKey
            ? controls.length - 1
            : 0
          : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
      controls[next]?.focus()
    }
  }

  function moveNav(index: number, key: string): void {
    const nextIndex =
      key === 'ArrowDown'
        ? (index + 1) % items.length
        : key === 'ArrowUp'
          ? (index + items.length - 1) % items.length
          : key === 'Home'
            ? 0
            : key === 'End'
              ? items.length - 1
              : null
    if (nextIndex === null) return
    const next = items[nextIndex]
    onSelect(next.id)
    document.getElementById(next.tabDomId)?.focus()
  }

  const active = items.find((item) => item.id === activeId) ?? items[0]

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the backdrop hosts the dismiss gesture (mouse down outside the dialog); the dialog's controls are real buttons and inputs and it closes on Escape. */}
      <div
        hidden={suspended}
        style={suspended ? { display: 'none' } : undefined}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <section
          ref={sectionRef}
          role="dialog"
          aria-modal="true"
          aria-label={labelledBy ? undefined : ariaLabel}
          aria-labelledby={labelledBy}
          onKeyDown={handleKeyDown}
          className="flex h-[min(660px,calc(100%-48px))] w-[min(920px,calc(100%-48px))] flex-col overflow-hidden rounded-[12px] border border-edge bg-dialog shadow-xl"
        >
          {labelledBy && screenReaderTitle ? (
            <h2 id={labelledBy} className="sr-only">
              {screenReaderTitle}
            </h2>
          ) : null}
          {!labelledBy && ariaLabel ? <span className="sr-only">{ariaLabel}</span> : null}
          <header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-edge pr-2.5 pl-5">
            {leading}
            <span className="truncate text-[15px] font-semibold text-project-title">{title}</span>
            {titleNote ? (
              <span className="shrink-0 text-[13px] text-ink-muted">{titleNote}</span>
            ) : null}
            <Icon.chevronRight size={12} aria-hidden className="shrink-0 text-ink-muted" />
            <span className="min-w-0 flex-1 truncate text-[15px] text-ink-secondary">
              {pageLabel}
            </span>
            <button
              type="button"
              aria-label={closeLabel}
              title={closeLabel}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-secondary hover:bg-highlight hover:text-ink',
                focusRing,
              )}
              onClick={onClose}
            >
              <Icon.close size={16} aria-hidden />
            </button>
          </header>
          <div className="flex min-h-0 flex-1">
            <div
              role="tablist"
              aria-label="Settings sections"
              aria-orientation="vertical"
              className="flex w-[200px] shrink-0 flex-col gap-0.5 border-r border-edge bg-field px-2.5 py-3"
            >
              {items.map((item, index) => {
                const selected = item.id === activeId
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={item.tabDomId}
                    aria-controls={item.panelDomId}
                    aria-selected={selected}
                    aria-current={selected ? 'page' : undefined}
                    tabIndex={selected ? 0 : -1}
                    data-testid={item.testId}
                    className={cn(
                      'nk-settings-nav flex h-9 w-full items-center gap-2.5 rounded-[8px] border-0 px-2.5 text-left text-[13px]',
                      focusRing,
                      selected
                        ? 'bg-selected font-medium text-project-title'
                        : 'bg-transparent text-ink-secondary',
                    )}
                    onClick={() => onSelect(item.id)}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'ArrowDown' ||
                        event.key === 'ArrowUp' ||
                        event.key === 'Home' ||
                        event.key === 'End'
                      ) {
                        event.preventDefault()
                        moveNav(index, event.key)
                      }
                    }}
                  >
                    <NavIcon icon={item.icon} />
                    {item.label}
                  </button>
                )
              })}
            </div>
            {items
              .filter((item) => item.id !== active?.id)
              .map((item) => (
                <div
                  key={item.id}
                  role="tabpanel"
                  id={item.panelDomId}
                  aria-labelledby={item.tabDomId}
                  hidden
                />
              ))}
            {active ? (
              <div
                role="tabpanel"
                id={active.panelDomId}
                aria-labelledby={active.tabDomId}
                className="min-w-0 flex-1 overflow-y-auto px-7 pt-6 pb-8"
              >
                {children}
              </div>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="shrink-0 border-t border-edge px-7 py-2 text-xs text-error">
              {error}
            </p>
          ) : null}
        </section>
      </div>
    </>
  )
}
