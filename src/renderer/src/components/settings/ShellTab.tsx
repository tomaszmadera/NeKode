import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { AppApi, ShellInfo } from '../../../../shared/ipc-contract'
import { projectShellKey } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { TEST_ID } from '../../lib/test-ids'

// Shell tab of the Project Settings modal (spec project-shell-selection).
// Entering the tab runs exactly one detection (Behaviour 1): a visible
// indicator replaces the form while it runs, and no other path ever probes
// the machine. The list shows `default` + detected + persisted custom
// entries; the per-project select saves under project.shell:<projectId> via
// the shared app_state (choosing Default clears the key). The custom-path add
// is validated in main (absolute + exists + is file) and persists app-level.

interface ShellTabProps {
  app: AppApi
  projectId: string | null
  /** Reload parent-held state after a settings change (parent wiring). */
  onSettingsChanged?: () => void
}

export function ShellTab({ app, projectId, onSettingsChanged }: ShellTabProps): React.JSX.Element {
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [detecting, setDetecting] = useState(true)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [savedChoice, setSavedChoice] = useState<string>('default')
  const [selected, setSelected] = useState('default')
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [customPath, setCustomPath] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)
  const selectRef = useRef<HTMLSelectElement>(null)

  // One detection + per-project choice load per tab entry (the modal mounts
  // this component fresh on each entry, so a plain mount effect is the
  // entry hook). Detection failure keeps the tab usable with `default` only.
  useEffect(() => {
    let alive = true
    setDetecting(true)
    setDetectError(null)
    const saved =
      projectId !== null
        ? app.state
            .get(projectShellKey(projectId))
            .then((value) => (alive ? (value ?? 'default') : 'default'))
            .catch(() => 'default')
        : Promise.resolve('default')
    void saved.then((choice) => {
      if (!alive) return
      setSavedChoice(choice)
      setSelected(choice)
    })
    app.terminals
      .shellDetect()
      .then((list) => {
        if (alive) {
          setShells(list)
          setDetecting(false)
        }
      })
      .catch((cause: unknown) => {
        if (alive) {
          setShells([])
          setDetecting(false)
          setDetectError(
            parseAppErrorPayload(cause)?.message ?? 'Shell detection failed. Showing Default only.',
          )
        }
      })
    return () => {
      alive = false
    }
  }, [app, projectId])

  async function save(): Promise<void> {
    if (projectId === null) return
    try {
      // Default stores an empty value (= unconfigured), matching the
      // handoff-dir convention: missing/empty means the platform default.
      await app.state.set(projectShellKey(projectId), selected === 'default' ? '' : selected)
      setSavedChoice(selected)
      setSaveState('saved')
      setSaveError(null)
      onSettingsChanged?.()
    } catch (cause) {
      setSaveState('error')
      setSaveError(parseAppErrorPayload(cause)?.message ?? 'Failed to save the shell choice.')
    }
  }

  async function addCustom(): Promise<void> {
    const path = customPath.trim()
    if (path.length === 0) return
    try {
      const entry = await app.terminals.shellAddCustom(path)
      setShells((previous) => [...previous.filter((shell) => shell.id !== entry.id), entry])
      setCustomPath('')
      setCustomError(null)
    } catch (cause) {
      setCustomError(parseAppErrorPayload(cause)?.message ?? 'Failed to add the shell path.')
    }
  }

  return (
    <div data-testid={TEST_ID.settingsShellTab}>
      {detecting ? (
        <p
          className="mt-4 flex items-center gap-2 text-xs text-ink-secondary"
          data-testid={TEST_ID.settingsShellDetecting}
          role="status"
        >
          <span
            aria-hidden
            className="inline-block h-3 w-3 animate-spin rounded-full border border-edge border-t-info"
          />
          Detecting shells…
        </p>
      ) : (
        <>
          {detectError ? (
            <p role="alert" className="mt-4 text-xs text-error">
              {detectError}
            </p>
          ) : null}
          {projectId !== null ? (
            <div className="mt-4">
              <label htmlFor="settings-shell-select" className="block text-sm text-ink-secondary">
                Shell for new terminals in this project
              </label>
              <div className="mt-2 flex items-center gap-2">
                <select
                  ref={selectRef}
                  id="settings-shell-select"
                  value={selected}
                  data-testid={TEST_ID.settingsShellSelect}
                  onChange={(event) => {
                    setSelected(event.target.value)
                    setSaveState('idle')
                  }}
                  className="h-control min-w-0 flex-1 rounded-md border border-edge bg-app px-3 text-sm text-ink focus-visible:outline focus-visible:outline-info"
                >
                  {shells.map((shell) => (
                    <option key={shell.id} value={shell.id}>
                      {shell.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="Save shell choice"
                  data-testid={TEST_ID.settingsShellSave}
                  disabled={selected === savedChoice}
                  className="h-control shrink-0 rounded-md bg-button px-4 text-sm text-ink hover:bg-button-hover disabled:opacity-50"
                  onClick={() => {
                    void save()
                  }}
                >
                  Save
                </button>
                {saveState === 'saved' ? (
                  <span className="text-xs text-success" data-testid={TEST_ID.settingsShellSaved}>
                    Saved
                  </span>
                ) : null}
              </div>
              {saveError ? (
                <p role="alert" className="mt-2 text-xs text-error">
                  {saveError}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-ink-muted">
                Applies to chats and bottom terminals created after the change. A shell that is
                later uninstalled falls back to the default.
              </p>
            </div>
          ) : null}
          <div className="mt-4 border-t border-edge pt-3">
            <label htmlFor="settings-shell-custom" className="block text-sm text-ink-secondary">
              Add a shell by absolute path
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="settings-shell-custom"
                value={customPath}
                placeholder="C:\\tools\\nu.exe"
                data-testid={TEST_ID.settingsShellCustomInput}
                onChange={(event) => {
                  setCustomPath(event.target.value)
                  setCustomError(null)
                }}
                className="min-w-0 flex-1 rounded-sm bg-highlight p-1 text-sm text-ink"
              />
              <button
                type="button"
                data-testid={TEST_ID.settingsShellCustomAdd}
                disabled={customPath.trim().length === 0}
                className="h-control shrink-0 rounded-md bg-button px-3 text-xs text-ink hover:bg-button-hover disabled:opacity-50"
                onClick={() => {
                  void addCustom()
                }}
              >
                Add
              </button>
            </div>
            {customError ? (
              <p role="alert" className="mt-2 text-xs text-error">
                {customError}
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
