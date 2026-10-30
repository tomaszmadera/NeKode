import {
  type AppApi,
  HARNESS_RESUME_SOURCE,
  type ProjectInfo,
  type ResumeSourceLibrary,
  type ResumeSourcePreview,
  type ResumeSourcePut,
  type ResumeSourceTemplate,
} from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PageIntro,
  primaryClass,
  quietClass,
  secondaryClass,
  selectClass,
  textClass,
} from './settings-ui'

const newTemplate = (): ResumeSourcePut => ({
  id: null,
  revision: null,
  name: '',
  prompt: 'Resume from {taskPath}',
  source: { kind: 'files', directory: '.', pattern: '*.md', recursive: false, identity: 'stem' },
})
const errorMessage = (cause: unknown) =>
  parseAppErrorPayload(cause)?.message ??
  'Resume templates could not be updated. Retry the operation.'

export function ResumeTemplatesSettings({ app }: { app: AppApi }): React.JSX.Element {
  const [library, setLibrary] = useState<ResumeSourceLibrary | null>(null)
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [form, setForm] = useState<ResumeSourcePut | null>(null)
  const [argumentKeys, setArgumentKeys] = useState<string[]>([])
  const [preview, setPreview] = useState<ResumeSourcePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const alive = useRef(false)
  const mutating = useRef(false)
  const request = useRef<string | null>(null)
  const current = library?.templates.find((row) => row.id === selectedId)

  const accept = useCallback((next: ResumeSourceLibrary): void => {
    setLibrary((previous) =>
      previous === null || previous.revision <= next.revision ? next : previous,
    )
  }, [])

  function discardPreview(): void {
    const id = request.current
    request.current = null
    if (id !== null)
      void app.resumeSources.cancel(id).catch((cause) => {
        if (alive.current) setError(errorMessage(cause))
      })
    setTesting(false)
    setPreview(null)
  }

  useEffect(() => {
    let active = true
    alive.current = true
    Promise.all([app.resumeSources.list(), app.projects.list()])
      .then(([next, registered]) => {
        if (!active) return
        accept(next)
        setProjects(registered)
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause))
      })
    const unsubscribe = app.resumeSources.onChanged(() => {
      const id = request.current
      request.current = null
      if (id !== null)
        void app.resumeSources.cancel(id).catch((cause) => {
          if (alive.current) setError(errorMessage(cause))
        })
      setTesting(false)
      setPreview(null)
      void app.resumeSources
        .list()
        .then((next) => {
          if (active) accept(next)
        })
        .catch((cause) => {
          if (active) setError(errorMessage(cause))
        })
    })
    return () => {
      active = false
      alive.current = false
      unsubscribe()
      const id = request.current
      request.current = null
      if (id !== null) void app.resumeSources.cancel(id).catch(() => undefined)
    }
  }, [app, accept])

  async function mutate(
    operation: () => Promise<ResumeSourceLibrary>,
    editResult = false,
  ): Promise<void> {
    if (mutating.current) return
    mutating.current = true
    setSaving(true)
    setError(null)
    discardPreview()
    try {
      const next = await operation()
      if (!alive.current) return
      accept(next)
      setForm(null)
      if (editResult) setSelectedId(next.templates.at(-1)?.id ?? '')
      else if (!next.templates.some((row) => row.id === selectedId)) setSelectedId('')
    } catch (cause) {
      if (alive.current) setError(errorMessage(cause))
    } finally {
      mutating.current = false
      if (alive.current) setSaving(false)
    }
  }

  async function test(): Promise<void> {
    if (current === undefined || !projectId || request.current !== null || form !== null) return
    const id = crypto.randomUUID()
    request.current = id
    setTesting(true)
    setPreview(null)
    setError(null)
    try {
      const result = await app.resumeSources.test(current.id, projectId, current.revision, id)
      if (alive.current && request.current === id) setPreview(result)
    } catch (cause) {
      if (alive.current && request.current === id) setError(errorMessage(cause))
    } finally {
      if (request.current === id) {
        request.current = null
        if (alive.current) setTesting(false)
      }
    }
  }

  function edit(template: ResumeSourceTemplate): void {
    discardPreview()
    setError(null)
    setForm(structuredClone(template))
    setArgumentKeys(
      template.source.kind === 'command' ? template.source.args.map(() => crypto.randomUUID()) : [],
    )
  }

  async function importLegacyPrompt(): Promise<void> {
    if (form === null) return
    setError(null)
    try {
      const imported = await app.resumeSources.importLegacy()
      if (imported === null) {
        setError('No legacy Resume template was found in settings.json.')
        return
      }
      setForm({ ...form, prompt: imported })
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <PageIntro
        title="Resume templates"
        description="Reuse a source and Resume instruction across projects. Test previews saved settings without changing the project's Resume action."
      />
      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {library === null ? (
        <p role="status">Loading Resume templates...</p>
      ) : (
        <>
          <div className="flex items-end gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Template
              <select
                className={selectClass}
                value={selectedId}
                disabled={saving}
                onChange={(event) => {
                  discardPreview()
                  setSelectedId(event.target.value)
                  setForm(null)
                  setError(null)
                }}
              >
                <option value="">Choose a template</option>
                {library.templates.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={secondaryClass}
              disabled={saving}
              onClick={() => {
                discardPreview()
                setForm(newTemplate())
                setError(null)
              }}
            >
              New template
            </button>
          </div>
          {current !== undefined && form === null && (
            <>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={secondaryClass}
                  disabled={saving}
                  onClick={() => edit(current)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={secondaryClass}
                  disabled={saving}
                  onClick={() =>
                    void mutate(
                      () => app.resumeSources.duplicate(current.id, current.revision),
                      true,
                    )
                  }
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className={quietClass}
                  disabled={saving}
                  onClick={() =>
                    void mutate(() => app.resumeSources.delete(current.id, current.revision))
                  }
                >
                  Delete
                </button>
              </div>
              <p className="whitespace-pre-wrap rounded border border-edge bg-field p-3 text-sm">
                {current.prompt}
              </p>
            </>
          )}
          {form !== null && (
            <form
              className="flex flex-col gap-4 rounded border border-edge p-4"
              onSubmit={(event) => {
                event.preventDefault()
                void mutate(() => app.resumeSources.put(form), true)
              }}
            >
              <fieldset disabled={saving} className="flex min-w-0 flex-col gap-4">
                <label className="flex flex-col gap-1 text-sm">
                  Name
                  <input
                    className={textClass}
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    required
                    maxLength={200}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Source
                  <select
                    className={selectClass}
                    value={form.source.kind === 'files' ? 'files' : form.source.protocol}
                    onChange={(event) => {
                      setArgumentKeys([])
                      setForm({
                        ...form,
                        prompt:
                          event.target.value === 'agent-harness'
                            ? 'Resume task {taskPath}'
                            : form.prompt,
                        source:
                          event.target.value === 'files'
                            ? newTemplate().source
                            : event.target.value === 'agent-harness'
                              ? structuredClone(HARNESS_RESUME_SOURCE)
                              : { kind: 'command', protocol: 'generic', executable: '', args: [] },
                      })
                    }}
                  >
                    <option value="files">Files</option>
                    <option value="generic">Custom command</option>
                    <option value="agent-harness">Agent Harness</option>
                  </select>
                </label>
                {form.source.kind === 'files' ? (
                  <>
                    <p className="text-xs text-ink-secondary">
                      Files provide continuation context. They are not validated unfinished tasks.
                      Links and directory junctions are excluded.
                    </p>
                    <label className="flex flex-col gap-1 text-sm">
                      Directory
                      <input
                        className={textClass}
                        value={form.source.directory}
                        onChange={(event) => {
                          if (form.source.kind === 'files')
                            setForm({
                              ...form,
                              source: { ...form.source, directory: event.target.value },
                            })
                        }}
                        required
                      />
                    </label>
                    <p className="text-xs text-ink-secondary">
                      Relative directories stay within each project. An absolute directory
                      explicitly permits another root. Use Linux paths for WSL projects.
                    </p>
                    <label className="flex flex-col gap-1 text-sm">
                      File name filter
                      <input
                        className={textClass}
                        value={form.source.pattern}
                        onChange={(event) => {
                          if (form.source.kind === 'files')
                            setForm({
                              ...form,
                              source: { ...form.source, pattern: event.target.value },
                            })
                        }}
                        required
                      />
                    </label>
                    <p className="text-xs text-ink-secondary">
                      Use a literal file name or wildcards * and ?. Do not include directory
                      separators.
                    </p>
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.source.recursive}
                        onChange={(event) => {
                          if (form.source.kind === 'files')
                            setForm({
                              ...form,
                              source: { ...form.source, recursive: event.target.checked },
                            })
                        }}
                      />
                      Search subdirectories
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      Candidate identity
                      <select
                        className={selectClass}
                        value={form.source.identity}
                        onChange={(event) => {
                          if (form.source.kind === 'files')
                            setForm({
                              ...form,
                              source: {
                                ...form.source,
                                identity: event.target.value as 'stem' | 'parent',
                              },
                            })
                        }}
                      >
                        <option value="stem">File name without extension</option>
                        <option value="parent">Immediate parent directory</option>
                      </select>
                    </label>
                  </>
                ) : form.source.protocol === 'agent-harness' ? (
                  <p className="text-sm text-ink-secondary">
                    Runs python .agents/scripts/taskctl list --json in the selected project.
                    Requires Agent Harness with task inventory support. Test reports install or
                    update errors.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-ink-secondary">
                      Test executes this local command in the selected project's runtime. Arguments
                      are passed separately without a shell. Output must be a JSON object with
                      success: true and tasks containing id, title and path.
                    </p>
                    <label className="flex flex-col gap-1 text-sm">
                      Executable
                      <input
                        className={textClass}
                        value={form.source.executable}
                        onChange={(event) => {
                          if (form.source.kind === 'command')
                            setForm({
                              ...form,
                              source: { ...form.source, executable: event.target.value },
                            })
                        }}
                        required
                      />
                    </label>
                    {form.source.args.map((argument, index) => (
                      <div className="flex gap-2" key={argumentKeys[index]}>
                        <label className="flex flex-1 flex-col gap-1 text-sm">
                          Argument {index + 1}
                          <input
                            className={textClass}
                            value={argument}
                            onChange={(event) => {
                              if (form.source.kind === 'command')
                                setForm({
                                  ...form,
                                  source: {
                                    ...form.source,
                                    args: form.source.args.map((value, position) =>
                                      position === index ? event.target.value : value,
                                    ),
                                  },
                                })
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className={quietClass}
                          aria-label={`Remove argument ${index + 1}`}
                          onClick={() => {
                            if (form.source.kind === 'command') {
                              setArgumentKeys((keys) =>
                                keys.filter((_, position) => position !== index),
                              )
                              setForm({
                                ...form,
                                source: {
                                  ...form.source,
                                  args: form.source.args.filter(
                                    (_, position) => position !== index,
                                  ),
                                },
                              })
                            }
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className={secondaryClass}
                      onClick={() => {
                        if (form.source.kind === 'command') {
                          setArgumentKeys((keys) => [...keys, crypto.randomUUID()])
                          setForm({
                            ...form,
                            source: { ...form.source, args: [...form.source.args, ''] },
                          })
                        }
                      }}
                    >
                      Add argument
                    </button>
                  </>
                )}
                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex items-center justify-between">
                    <label htmlFor="resume-instruction-field">Resume instruction</label>
                    <button
                      type="button"
                      className={`${secondaryClass} text-xs py-1 px-2.5 h-auto`}
                      onClick={() => void importLegacyPrompt()}
                    >
                      Import legacy template
                    </button>
                  </div>
                  <textarea
                    id="resume-instruction-field"
                    className={`${textClass} h-28 py-2`}
                    value={form.prompt}
                    onChange={(event) => setForm({ ...form, prompt: event.target.value })}
                    required
                  />
                </div>
                <p className="text-xs text-ink-secondary">
                  Include {'{taskPath}'}. The legacy alias {'{handoffPath}'} is also accepted. Save
                  before testing.
                </p>
                <div className="flex gap-2">
                  <button type="submit" className={primaryClass}>
                    Save template
                  </button>
                  <button
                    type="button"
                    className={secondaryClass}
                    onClick={() => {
                      setForm(null)
                      setError(null)
                    }}
                  >
                    Cancel editing
                  </button>
                </div>
              </fieldset>
            </form>
          )}
          <section
            aria-label="Test saved template"
            className="flex flex-col gap-3 border-t border-edge pt-4"
          >
            <label className="flex flex-col gap-1 text-sm">
              Test project
              <select
                className={selectClass}
                value={projectId}
                onChange={(event) => {
                  discardPreview()
                  setProjectId(event.target.value)
                  setError(null)
                }}
              >
                <option value="">Choose a registered project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} ({project.path})
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className={secondaryClass}
                disabled={current === undefined || !projectId || form !== null || testing || saving}
                onClick={() => void test()}
              >
                {testing ? 'Testing...' : 'Test saved template'}
              </button>
              {testing && (
                <button type="button" className={quietClass} onClick={discardPreview}>
                  Cancel Test
                </button>
              )}
            </div>
            {projects.length === 0 && (
              <p className="text-sm text-ink-secondary">
                Add a project before testing a Resume source.
              </p>
            )}
            {preview !== null && (
              <section aria-label="Source preview" className="flex flex-col gap-2">
                {preview.candidates.length === 0 ? (
                  <p>No candidates found.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {preview.candidates.map((row) => (
                      <li
                        key={`${row.id}:${row.path}`}
                        className="rounded border border-edge p-3 text-sm"
                      >
                        <p>
                          {row.title} ({row.id})
                        </p>
                        <p className="break-all font-mono text-xs text-ink-secondary">
                          {row.displayPath}
                        </p>
                        <p className="text-xs text-ink-secondary">
                          {row.status ?? 'File'} - {new Date(row.modifiedAt).toLocaleString()}
                        </p>
                        {row.next_action !== undefined && <p>{row.next_action}</p>}
                      </li>
                    ))}
                  </ul>
                )}
                {preview.rejections.length > 0 && (
                  <ul aria-label="Rejected files">
                    {preview.rejections.map((row) => (
                      <li key={row.path} className="text-sm text-danger">
                        {row.path}: {row.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </section>
        </>
      )}
    </div>
  )
}
