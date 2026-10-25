import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { AppApi, ShellInfo } from '../../../../shared/ipc-contract'
import { projectColorKey, projectShellKey } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { useMutationGuard } from '../../hooks/useMutationGuard'
import { cn } from '../../lib/cn'
import { PROJECT_COLOR_PALETTE } from '../../lib/project-avatar'
import { TEST_ID } from '../../lib/test-ids'
import {
  FieldRow,
  GroupBox,
  GroupFooter,
  InfoStrip,
  monoClass,
  PageIntro,
  primaryClass,
  SectionLabel,
  SettingsGroup,
  SettingsSelect,
  StackedRow,
  secondaryClass,
} from './settings-ui'

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

  const colorNames = ['Violet', 'Blue', 'Salmon', 'Green', 'Yellow', 'Pink', 'Teal']
  const shellNote =
    'Applies to chats and bottom terminals created after the change. A shell that is later uninstalled falls back to the default for Local projects. WSL uses its distribution default for old host choices; an unavailable Linux shell shows an error.'

  return (
    <div className="flex max-w-[660px] flex-col gap-7">
      <PageIntro title="Shell" description="Terminal setup and colour for this project." />
      {detecting ? (
        <p
          className="flex items-center gap-2 text-xs text-ink-secondary"
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
            <p role="alert" className="text-xs text-error">
              {detectError}
            </p>
          ) : null}
          <SettingsGroup label="Shell">
            <SectionLabel title="Shell" />
            <GroupBox>
              {projectId !== null ? (
                <FieldRow
                  label="Shell for new terminals"
                  htmlFor="settings-shell-select"
                  description="Applies to chats and bottom terminals created after the change."
                >
                  <SettingsSelect
                    id="settings-shell-select"
                    value={selected}
                    selectRef={selectRef}
                    testId={TEST_ID.settingsShellSelect}
                    onChange={(value) => {
                      setSelected(value)
                      setSaveState('idle')
                    }}
                  >
                    {shells.map((shell) => (
                      <option key={shell.id} value={shell.id}>
                        {shell.label}
                      </option>
                    ))}
                  </SettingsSelect>
                </FieldRow>
              ) : null}
              <InfoStrip>{shellNote}</InfoStrip>
              <StackedRow
                label="Add a shell by absolute path"
                htmlFor="settings-shell-custom"
                divided
              >
                <span className="flex gap-2">
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
                    spellCheck={false}
                    data-testid={TEST_ID.settingsShellCustomInput}
                    onChange={(event) => {
                      setCustomPath(event.target.value)
                      setCustomError(null)
                    }}
                    className={cn(monoClass, 'min-w-0 flex-1')}
                  />
                  <button
                    type="button"
                    data-testid={TEST_ID.settingsShellCustomAdd}
                    disabled={guard.busy || customPath.trim().length === 0}
                    className={secondaryClass}
                    onClick={() => {
                      void addCustom()
                    }}
                  >
                    Add
                  </button>
                </span>
                <span>The shell is added to the list above.</span>
              </StackedRow>
              {customError ? (
                <p role="alert" className="border-t border-edge px-4 py-2 text-xs text-error">
                  {customError}
                </p>
              ) : null}
              {projectId !== null ? (
                <GroupFooter
                  status={
                    saveState === 'saved' ? (
                      <span className="text-success" data-testid={TEST_ID.settingsShellSaved}>
                        Saved
                      </span>
                    ) : saveError ? (
                      <span role="alert" className="text-error">
                        {saveError}
                      </span>
                    ) : null
                  }
                >
                  <button
                    type="button"
                    aria-label="Save shell choice"
                    data-testid={TEST_ID.settingsShellSave}
                    disabled={guard.busy || selected === savedChoice}
                    className={primaryClass}
                    onClick={() => {
                      void save()
                    }}
                  >
                    Save
                  </button>
                </GroupFooter>
              ) : null}
            </GroupBox>
          </SettingsGroup>
          {projectId !== null ? (
            <SettingsGroup label="Appearance">
              <SectionLabel title="Appearance" />
              <GroupBox>
                <div
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 px-4 py-3"
                  data-testid={TEST_ID.settingsProjectColorSection}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span id="settings-project-color" className="text-[13px] font-medium text-ink">
                      Project colour
                    </span>
                    <span className="text-xs text-ink-muted">
                      Icon and highlight colour. Auto picks one from the project order.
                    </span>
                  </div>
                  <span
                    role="radiogroup"
                    aria-labelledby="settings-project-color"
                    className="flex items-center gap-2"
                  >
                    <label className="inline-flex cursor-pointer">
                      <input
                        type="radio"
                        name="settings-project-color"
                        className="peer sr-only"
                        checked={!savedColor}
                        data-testid="project-color-auto"
                        onChange={() => void handleColorSelect('')}
                      />
                      <span
                        className={cn(
                          'flex h-7 items-center rounded-[7px] border border-edge px-2.5 text-xs font-semibold peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
                          !savedColor
                            ? 'bg-selected text-project-title'
                            : 'bg-transparent text-ink-secondary',
                        )}
                        style={
                          !savedColor
                            ? {
                                boxShadow:
                                  '0 0 0 2px var(--color-dialog), 0 0 0 4px var(--color-ink)',
                              }
                            : undefined
                        }
                      >
                        Auto
                      </span>
                    </label>
                    {PROJECT_COLOR_PALETTE.map((color, index) => {
                      const isSelected = savedColor === color
                      const name = colorNames[index] ?? color
                      return (
                        <label key={color} title={name} className="inline-flex cursor-pointer">
                          <input
                            type="radio"
                            name="settings-project-color"
                            className="peer sr-only"
                            checked={isSelected}
                            data-testid={`project-color-${color}`}
                            aria-label={name}
                            onChange={() => void handleColorSelect(color)}
                          />
                          <span
                            aria-hidden
                            className="h-7 w-7 rounded-[7px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
                            style={{
                              backgroundColor: color,
                              boxShadow: isSelected
                                ? '0 0 0 2px var(--color-dialog), 0 0 0 4px var(--color-ink)'
                                : undefined,
                            }}
                          />
                        </label>
                      )
                    })}
                  </span>
                </div>
              </GroupBox>
            </SettingsGroup>
          ) : null}
        </>
      )}
    </div>
  )
}
