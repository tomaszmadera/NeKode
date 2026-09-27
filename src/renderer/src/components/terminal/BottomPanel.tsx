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
  onResizeStart,
  onResizeNudge,
}: BottomPanelProps): React.JSX.Element {
  const visibleTabs =
    activeProjectId === null ? [] : tabs.filter((tab) => tab.projectId === activeProjectId)

  return (
    <section
      className="flex shrink-0 flex-col border-t border-neutral-800 bg-neutral-950"
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
        <div className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-neutral-800 bg-neutral-900/60">
          {visibleTabs.map((tab) => {
            const selected = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                className={cn(
                  'flex shrink-0 items-stretch border-r border-neutral-800',
                  selected && 'bg-neutral-800/70',
                )}
                data-testid={testIdFor.bottomTab(tab.id)}
                data-selected={selected ? 'true' : 'false'}
              >
                <button
                  type="button"
                  className={cn(
                    'max-w-48 truncate px-3 text-xs text-neutral-400 hover:text-neutral-100',
                    selected && 'text-neutral-100',
                  )}
                  data-selected={selected ? 'true' : 'false'}
                  onClick={() => onSelectTab(tab.id)}
                >
                  {tab.label}
                </button>
                <button
                  type="button"
                  className="px-2 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100"
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
            className="shrink-0 px-3 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
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
              />
              {tab.status === 'error' && visible ? (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/80 px-6 text-center"
                  data-testid={TEST_ID.bottomTerminalError}
                  role="alert"
                >
                  <p className="text-sm text-red-300">
                    {tab.errorMessage ?? 'Failed to start the terminal.'}
                  </p>
                  <button
                    type="button"
                    className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800"
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
              className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800"
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
