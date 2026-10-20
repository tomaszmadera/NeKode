import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { AppApi, ShellInfo } from '../../../../shared/ipc-contract'
import { projectColorKey, projectShellKey } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { useMutationGuard } from '../../hooks/useMutationGuard'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { PROJECT_COLOR_PALETTE } from '../../lib/project-avatar'
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
  onProjectColorChange?: (projectId: string, color: string | null) => void
}

export function ShellTab({
  app,
  projectId,
  onSettingsChanged,
  onProjectColorChange,
}: ShellTabProps): React.JSX.Element {
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [detecting, setDetecting] = useState(true)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [savedChoice, setSavedChoice] = useState<string>('default')
  const [selected, setSelected] = useState('default')
  const [savedColor, setSavedColor] = useState<string>('')
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [customPath, setCustomPath] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const guard = useMutationGuard()

  // One detection + per-project choice load per tab entry (the modal mounts
  // this component fresh on each entry, so a plain mount effect is the
  // entry hook). Detection failure keeps the tab usable with `default` only.
  useEffect(() => {
    let alive = true
    setDetecting(true)
    setDetectError(null)
    if (projectId !== null) {
      void app.state
        .get(projectColorKey(projectId))
        .then((color) => {
          if (alive) setSavedColor(color ?? '')
        })
        .catch(() => undefined)
    }
    let savedError: string | null = null
    const saved =
      projectId !== null
        ? app.state
            .get(projectShellKey(projectId))
            .then((value) => (alive ? (value ?? 'default') : 'default'))
            .catch((cause: unknown) => {
              if (alive) {
                savedError =
                  parseAppErrorPayload(cause)?.message ?? 'Failed to load the stored shell choice.'
              }
              return 'default'
            })
        : Promise.resolve('default')
    void Promise.all([saved, app.terminals.shellDetect(projectId)])
      .then(([choice, list]) => {
        if (alive) {
          setSavedChoice(choice)
          setSelected(list.some((shell) => shell.id === choice) ? choice : 'default')
          setShells(list)
          setDetecting(false)
          if (savedError) {
            setDetectError(savedError)
          }
        }
      })
      .catch((cause: unknown) => {
        if (alive) {
          setShells([{ id: 'default', label: 'Default' }])
          setSelected('default')
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
    await guard.run(async () => {
      try {
        // Default stores an empty value (= unconfigured), matching the
        // handoff-dir convention: missing/empty means the platform default.
        await app.state.set(projectShellKey(projectId), selected === 'default' ? '' : selected)
        setSavedChoice(selected)
        setSaveState('saved')
        setSaveError(null)
        setDetectError(null)
        onSettingsChanged?.()
      } catch (cause) {
        setSaveState('error')
        setSaveError(parseAppErrorPayload(cause)?.message ?? 'Failed to save the shell choice.')
      }
    })
  }

  async function handleColorSelect(color: string): Promise<void> {
    if (projectId === null) return
    await guard.run(async () => {
      try {
        await app.state.set(projectColorKey(projectId), color)
        setSavedColor(color)
        onProjectColorChange?.(projectId, color.length > 0 ? color : null)
        onSettingsChanged?.()
      } catch {
        // ignore
      }
    })
  }

  async function addCustom(): Promise<void> {
    const path = customPath.trim()
    if (path.length === 0) return
    await guard.run(async () => {
      try {
        const entry = await app.terminals.shellAddCustom(path, projectId)
        setShells((previous) => [...previous.filter((shell) => shell.id !== entry.id), entry])
        setCustomPath('')
        setCustomError(null)
      } catch (cause) {
        setCustomError(parseAppErrorPayload(cause)?.message ?? 'Failed to add the shell path.')
      }
    })
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
                  disabled={guard.busy || selected === savedChoice}
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
                later uninstalled falls back to the default for Local projects. WSL uses its
                distribution default for old host choices; an unavailable Linux shell shows an
                error.
              </p>
            </div>
          ) : null}
          {projectId !== null ? (
            <div
              className="mt-4 border-t border-edge pt-3"
              data-testid={TEST_ID.settingsProjectColorSection}
            >
              <span className="block text-sm text-ink-secondary">Project color</span>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="project-color-auto"
                  className={cn(
                    'flex h-7 items-center rounded-md border px-2.5 text-xs transition-colors',
                    !savedColor
                      ? 'border-accent bg-highlight text-ink font-medium'
                      : 'border-edge bg-panel text-ink-secondary hover:bg-highlight hover:text-ink',
                  )}
                  onClick={() => void handleColorSelect('')}
                >
                  Auto
                </button>
                {PROJECT_COLOR_PALETTE.map((color) => {
                  const isSelected = savedColor === color
                  return (
                    <button
                      key={color}
                      type="button"
                      data-testid={`project-color-${color}`}
                      aria-label={`Project color ${color}`}
                      title={color}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-md border transition-transform hover:scale-105',
                        isSelected ? 'border-accent ring-2 ring-accent/40' : 'border-edge',
                      )}
                      style={{ backgroundColor: color }}
                      onClick={() => void handleColorSelect(color)}
                    >
                      {isSelected ? (
                        <Icon.check size={14} className="text-app" aria-hidden />
                      ) : null}
                    </button>
                  )
                })}
              </div>
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
                placeholder={
                  shells[0]?.label.includes('WSL:')
                    ? '/bin/bash'
                    : app.platform === undefined || app.platform === 'win32'
                      ? 'C:\\tools\\nu.exe'
                      : '/usr/bin/fish'
                }
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
                disabled={guard.busy || customPath.trim().length === 0}
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
