import type React from 'react'
import type { AppApi } from '../../../../shared/ipc-contract'
import { BOTTOM_REGION_SIZE } from '../../hooks/useResizableRegion'
import { cn } from '../../lib/cn'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { ResizeHandle } from '../layout/ResizeHandle'
import type { BottomTab } from './bottom-tabs'
import { ChatTerminal } from './ChatTerminal'

// Full-width auxiliary terminal above the status bar (spec Behaviour 1).
// Every tab view stays mounted while hidden (panel hide, tab switch, project
// switch) so the PTY and xterm scrollback survive. The host owns the tab list.

interface BottomPanelProps {
  app: AppApi
  open: boolean
  height: number
  activeProjectId: string | null
  tabs: readonly BottomTab[]
  activeTabId: string | null
  onNewTerminal: () => void
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onExit: (tabId: string) => void
  onSpawnError: (tabId: string, message: string) => void
  onRetry: (tabId: string) => void
  /** Bottom-terminal delivery: the tab's terminal view is subscribed and ready. */
  onSessionReady: (tabId: string) => void
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void
  onResizeNudge: (delta: number) => void
}

export function BottomPanel({
  app,
  open,
  height,
  activeProjectId,
  tabs,
  activeTabId,
  onNewTerminal,
  onSelectTab,
  onCloseTab,
  onExit,
  onSpawnError,
  onRetry,
  onSessionReady,
  onResizeStart,
  onResizeNudge,
}: BottomPanelProps): React.JSX.Element {
  const visibleTabs =
    activeProjectId === null ? [] : tabs.filter((tab) => tab.projectId === activeProjectId)

  return (
    <section
      className="flex shrink-0 flex-col border-t border-edge bg-app"
      data-testid={TEST_ID.bottomRegion}
      style={{ display: open ? 'flex' : 'none', height }}
    >
      <ResizeHandle
        axis="y"
        size={height}
        minSize={BOTTOM_REGION_SIZE.min}
        maxSize={BOTTOM_REGION_SIZE.max}
        onResizeStart={onResizeStart}
        onResizeNudge={onResizeNudge}
        testId={TEST_ID.bottomResizeHandle}
      />
      {visibleTabs.length > 0 ? (
        <div className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-edge bg-app px-1 pt-1">
          {visibleTabs.map((tab) => {
            const selected = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                className={cn(
                  'flex shrink-0 items-stretch rounded-t-md',
                  selected ? 'bg-button' : 'border border-edge bg-tab-inactive hover:bg-highlight',
                )}
                data-testid={testIdFor.bottomTab(tab.id)}
                data-selected={selected ? 'true' : 'false'}
              >
                <button
                  type="button"
                  className={cn(
                    'max-w-48 truncate px-3 text-xs text-ink-secondary hover:text-ink',
                    selected && 'text-ink',
                  )}
                  data-selected={selected ? 'true' : 'false'}
                  onClick={() => onSelectTab(tab.id)}
                >
                  {tab.label}
                </button>
                <button
                  type="button"
                  className="px-2 text-xs text-ink-muted hover:bg-highlight hover:text-ink"
                  aria-label={`Close ${tab.label}`}
                  data-testid={testIdFor.bottomTabClose(tab.id)}
                  onClick={() => onCloseTab(tab.id)}
                >
                  x
                </button>
              </div>
            )
          })}
          <button
            type="button"
            className="shrink-0 rounded-t-md px-3 text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
            data-testid={TEST_ID.bottomNewTerminal}
            onClick={onNewTerminal}
          >
            New terminal
          </button>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => {
          const visible = open && tab.id === activeTabId
          return (
            <div
              key={`${tab.id}:${tab.generation}`}
              className="absolute inset-0"
              style={{ display: visible ? 'block' : 'none' }}
              data-testid={testIdFor.bottomTerminal(tab.id)}
            >
              <ChatTerminal
                app={app}
                chatId={tab.id}
                cwd={tab.cwd}
                visible={visible}
                focused={visible}
                onExit={() => onExit(tab.id)}
                onClose={() => onCloseTab(tab.id)}
                onSpawnError={(message) => onSpawnError(tab.id, message)}
                onReady={() => onSessionReady(tab.id)}
              />
              {tab.status === 'error' && visible ? (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-app/80 px-6 text-center"
                  data-testid={TEST_ID.bottomTerminalError}
                  role="alert"
                >
                  <p className="text-sm text-error">
                    {tab.errorMessage ?? 'Failed to start the terminal.'}
                  </p>
                  <button
                    type="button"
                    className="rounded-md bg-button px-3 py-1.5 text-xs text-ink hover:bg-button-hover"
                    data-testid={TEST_ID.bottomTerminalRetry}
                    onClick={() => onRetry(tab.id)}
                  >
                    Retry
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
        {visibleTabs.length === 0 ? (
          <div
            className="flex h-full items-center justify-center"
            data-testid={TEST_ID.bottomEmpty}
          >
            <button
              type="button"
              className="rounded-md bg-button px-3 py-1.5 text-xs text-ink hover:bg-button-hover"
              data-testid={TEST_ID.bottomNewTerminal}
              onClick={onNewTerminal}
            >
              New terminal
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
