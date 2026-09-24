import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type React from 'react'
import { useEffect, useRef } from 'react'
import type { AppApi } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'

// One xterm.js view per task session (UX-UI §17). The view owns the xterm
// instance and the bridge subscriptions; the PTY itself lives in the main
// process (node-pty) and is spawned lazily on this component's first attach.
// Hidden (deselected) instances stay mounted so scrollback and the live PTY
// survive task switches (spec Behaviour 6).

interface TaskTerminalProps {
  app: AppApi
  taskId: string
  /** Project directory; becomes the PTY cwd on first attach. */
  cwd: string
  /** Whether this view is the selected task's visible terminal. */
  visible: boolean
  /** PTY exit: the session ended (exit-code notice is shown by the host). */
  onExit: (exitCode: number) => void
  /** Spawn failure (e.g. project directory missing): typed error state. */
  onSpawnError: (message: string) => void
}

function errorMessage(error: unknown, fallback: string): string {
  return parseAppErrorPayload(error)?.message ?? fallback
}

export function TaskTerminal({
  app,
  taskId,
  cwd,
  visible,
  onExit,
  onSpawnError,
}: TaskTerminalProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Latest callbacks without re-creating the terminal session on re-render.
  const appRef = useRef(app)
  const onExitRef = useRef(onExit)
  const onSpawnErrorRef = useRef(onSpawnError)
  appRef.current = app
  onExitRef.current = onExit
  onSpawnErrorRef.current = onSpawnError

  useEffect(() => {
    const container = containerRef.current
    if (container === null) {
      return
    }

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#e5e5e5',
        selectionBackground: '#3f3f46',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)

    function fitAndResize(): void {
      // Zero-sized (hidden or not yet laid out) containers must not fit; the
      // next resize/visibility change retries with real dimensions.
      if (container === null || container.clientWidth === 0 || container.clientHeight === 0) {
        return
      }
      try {
        fitAddon.fit()
      } catch {
        // A detached container can still fail to fit; the next resize can.
        return
      }
      void appRef.current.terminals.resize(taskId, terminal.cols, terminal.rows).catch(() => {
        // Resizes racing a session exit are expected; nothing to recover.
      })
    }

    const unsubscribeData = appRef.current.terminals.onData(taskId, (data) => {
      terminal.write(data)
    })
    const unsubscribeExit = appRef.current.terminals.onExit(taskId, (exitCode) => {
      onExitRef.current(exitCode)
    })
    const inputSubscription = terminal.onData((data) => {
      void appRef.current.terminals.write(taskId, data).catch(() => undefined)
    })

    // Lazy spawn: the main process creates the PTY on this first attach.
    void appRef.current.terminals
      .create(taskId, cwd)
      .then(() => {
        fitAndResize()
      })
      .catch((error: unknown) => {
        onSpawnErrorRef.current(errorMessage(error, 'Failed to start the terminal for this task.'))
      })

    // Fit on workspace open and on container resize. ResizeObserver is the
    // precise signal where available (jsdom tests fall back to window resize).
    let cleanupResize: () => void = () => undefined
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        fitAndResize()
      })
      observer.observe(container)
      cleanupResize = () => {
        observer.disconnect()
      }
    } else {
      const onWindowResize = (): void => {
        fitAndResize()
      }
      window.addEventListener('resize', onWindowResize)
      cleanupResize = () => {
        window.removeEventListener('resize', onWindowResize)
      }
    }
    fitAndResize()

    return () => {
      cleanupResize()
      unsubscribeData()
      unsubscribeExit()
      inputSubscription.dispose()
      terminal.dispose()
    }
    // Session identity is fixed per mount; the host remounts (new generation)
    // when a dead session must be replaced.
  }, [taskId, cwd])

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-neutral-950"
      data-testid={`terminal-canvas-${taskId}`}
      style={{ display: visible ? 'block' : 'none' }}
    />
  )
}
