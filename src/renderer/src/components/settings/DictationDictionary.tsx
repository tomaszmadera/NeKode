import type {
  CreateDictionaryEntryInput,
  DictationDictionaryEntry,
  DictationDictionaryError,
  DictationDictionary as LegacyDictionary,
  UpdateDictionaryEntryInput,
} from '@shared/contracts/dictation-contract'
import type { AppApi, ProjectInfo } from '@shared/ipc-contract'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { focusRing, GroupBox, SwitchControl, secondaryClass } from './settings-ui'

export interface DictationDictionaryErrorEntry {
  readonly kind: DictationDictionaryError
  readonly code: DictationDictionaryError
  readonly message: string
}

export const DICTATION_DICTIONARY_ERROR_TABLE: Record<
  DictationDictionaryError,
  DictationDictionaryErrorEntry
> = {
  'bridge-missing': {
    kind: 'bridge-missing',
    code: 'bridge-missing',
    message:
      'The OpenWhispr local bridge is missing. Start OpenWhispr, then refresh the dictionary.',
  },
  'bridge-invalid': {
    kind: 'bridge-invalid',
    code: 'bridge-invalid',
    message:
      'The OpenWhispr local bridge configuration is invalid. Restart OpenWhispr, then refresh the dictionary.',
  },
  unreachable: {
    kind: 'unreachable',
    code: 'unreachable',
    message:
      'The OpenWhispr local bridge is unavailable. Check OpenWhispr, then refresh the dictionary.',
  },
  'auth-failed': {
    kind: 'auth-failed',
    code: 'auth-failed',
    message:
      'The OpenWhispr local bridge rejected authentication. Restart OpenWhispr, then refresh the dictionary.',
  },
  'malformed-response': {
    kind: 'malformed-response',
    code: 'malformed-response',
    message:
      'The OpenWhispr dictionary response is invalid. No complete dictionary could be displayed.',
  },
  'unsupported-pagination': {
    kind: 'unsupported-pagination',
    code: 'unsupported-pagination',
    message:
      'This OpenWhispr bridge requires unsupported dictionary pagination. No complete dictionary could be displayed.',
  },
  'dictionary-limit': {
    kind: 'dictionary-limit',
    code: 'dictionary-limit',
    message:
      'The OpenWhispr dictionary exceeds the supported limit of 10,000 entries. No complete dictionary could be displayed.',
  },
}

export interface DictationDictionaryProps {
  api: AppApi['dictation']
  app?: AppApi
  projectId?: string | null
  projects?: ProjectInfo[]
}

export function DictationDictionary({
  api,
  app,
  projectId: externalProjectId,
  projects: externalProjects,
}: DictationDictionaryProps) {
  const [entries, setEntries] = useState<DictationDictionaryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [legacyError, setLegacyError] = useState<DictationDictionaryError | null>(null)
  const [activeTab, setActiveTab] = useState<'global' | 'project'>('global')
  const [projects, setProjects] = useState<ProjectInfo[]>(externalProjects ?? [])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    externalProjectId ?? null,
  )
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Form / modal state
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formTerm, setFormTerm] = useState('')
  const [formAliases, setFormAliases] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formScope, setFormScope] = useState<'global' | 'project'>('global')
  const [formProjectId, setFormProjectId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [formSaving, setFormSaving] = useState(false)

  // Load projects if not provided
  useEffect(() => {
    if (externalProjects && externalProjects.length > 0) {
      setProjects(externalProjects)
      if (!selectedProjectId && externalProjects[0]) {
        setSelectedProjectId(externalProjects[0].id)
      }
      return
    }

    const projectsApi =
      app?.projects ??
      (typeof window !== 'undefined'
        ? (window as unknown as { app?: AppApi }).app?.projects
        : undefined)
    if (projectsApi?.list) {
      projectsApi
        .list()
        .then((list) => {
          setProjects(list)
          if (!selectedProjectId && list.length > 0 && list[0]) {
            setSelectedProjectId(list[0].id)
          }
        })
        .catch(() => {})
    }
  }, [app, externalProjects, selectedProjectId])

  // Load dictionary entries
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTrigger is the manual refresh token
  useEffect(() => {
    let disposed = false
    setLoading(true)
    setLoadFailed(false)
    setDeleteError(null)
    setLegacyError(null)

    const queryProjectId =
      activeTab === 'project' && selectedProjectId ? selectedProjectId : undefined

    api
      .dictionaryList(queryProjectId)
      .then(
        (res) => {
          if (disposed) return
          if (!res) {
            setEntries([])
            return
          }
          if ('state' in res) {
            const legacy = res as LegacyDictionary
            if (legacy.state === 'unavailable') {
              setLegacyError(legacy.error)
              setEntries([])
            } else if (legacy.state === 'ready') {
              setEntries(
                legacy.terms.map((t, idx) => ({
                  id: `legacy-${idx}`,
                  term: t,
                  aliases: [],
                  description: null,
                  scope: 'global' as const,
                  projectId: null,
                  enabled: true,
                  createdAt: '',
                  updatedAt: '',
                })),
              )
            }
          } else if (Array.isArray(res)) {
            setEntries(res)
          }
        },
        () => {
          if (!disposed) {
            setLoadFailed(true)
          }
        },
      )
      .finally(() => {
        if (!disposed) {
          setLoading(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [api, activeTab, selectedProjectId, refreshTrigger])

  // Filter entries according to active tab and selected project
  const filteredEntries = entries.filter((entry) => {
    if (activeTab === 'global') {
      return entry.scope === 'global'
    }
    // project tab
    if (entry.scope !== 'project') return false
    if (selectedProjectId) {
      return entry.projectId === selectedProjectId
    }
    return true
  })

  // Open add form
  function handleOpenAdd() {
    setEditingId(null)
    setFormTerm('')
    setFormAliases('')
    setFormDescription('')
    setFormScope(activeTab)
    setFormProjectId(activeTab === 'project' ? selectedProjectId : null)
    setFormError(null)
    setIsFormOpen(true)
  }

  // Open edit form
  function handleOpenEdit(entry: DictationDictionaryEntry) {
    setEditingId(entry.id)
    setFormTerm(entry.term)
    setFormAliases(entry.aliases?.join(', ') ?? '')
    setFormDescription(entry.description ?? '')
    setFormScope(entry.scope)
    setFormProjectId(entry.projectId)
    setFormError(null)
    setIsFormOpen(true)
  }

  // Toggle enabled
  async function handleToggle(entry: DictationDictionaryEntry) {
    const nextEnabled = !entry.enabled
    try {
      const updated = await api.dictionaryToggle(entry.id, nextEnabled)
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id ? { ...e, enabled: updated?.enabled ?? nextEnabled } : e,
        ),
      )
    } catch {
      // Revert on error
      setEntries((prev) => [...prev])
    }
  }

  // Delete entry
  async function handleDelete(id: string) {
    setDeleteError(null)
    try {
      await api.dictionaryDelete(id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
    } catch {
      setDeleteError('The dictionary entry could not be deleted. Try again.')
    }
  }

  // Save add/edit form
  async function handleSaveForm(e: React.FormEvent) {
    e.preventDefault()
    const trimmedTerm = formTerm.trim()
    if (!trimmedTerm) {
      setFormError('Term is required.')
      return
    }

    const aliases = formAliases
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a.length > 0)

    setFormSaving(true)
    setFormError(null)

    try {
      if (editingId) {
        const updateInput: UpdateDictionaryEntryInput = {
          term: trimmedTerm,
          aliases,
          description: formDescription.trim() || null,
        }
        const updated = await api.dictionaryUpdate(editingId, updateInput)
        setEntries((prev) =>
          prev.map((entry) => (entry.id === editingId ? { ...entry, ...updated } : entry)),
        )
      } else {
        const createInput: CreateDictionaryEntryInput = {
          term: trimmedTerm,
          aliases,
          description: formDescription.trim() || null,
          scope: formScope,
          projectId: formScope === 'project' ? formProjectId || selectedProjectId : null,
          enabled: true,
        }
        const created = await api.dictionaryAdd(createInput)
        setEntries((prev) => [...prev, created])
      }
      setIsFormOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save dictionary entry.')
    } finally {
      setFormSaving(false)
    }
  }

  return (
    <section
      aria-labelledby="dictation-dictionary-title"
      className="flex flex-col gap-2.5 text-sm text-ink-secondary"
      data-testid="dictation-dictionary"
    >
      <div className="flex items-center gap-3">
        <h3
          id="dictation-dictionary-title"
          aria-label="Dictionary (OpenWhispr)"
          className="m-0 flex-1 text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase"
        >
          Dictionary
        </h3>
        <button
          type="button"
          data-testid="dictation-dictionary-add-button"
          onClick={handleOpenAdd}
          className={cn(secondaryClass, 'gap-1.5')}
        >
          <Icon.plus size={14} aria-hidden />
          Add term
        </button>
      </div>

      <p className="text-xs text-ink-muted">
        Shared technical dictionary and phonetic aliases. Terms defined in Project scope take
        precedence over matching Global terms.
      </p>

      <GroupBox>
        <div className="flex items-center gap-3 px-4 py-2.5">
          <fieldset
            aria-label="Dictionary scope"
            className="m-0 inline-flex min-w-0 gap-0.5 rounded-[9px] border border-edge bg-field p-[3px]"
          >
            <button
              type="button"
              data-testid="dictation-dictionary-tab-global"
              aria-pressed={activeTab === 'global'}
              className={cn(
                'h-8 rounded-[6px] px-3 text-[13px]',
                focusRing,
                activeTab === 'global'
                  ? 'bg-selected font-medium text-project-title'
                  : 'text-ink-secondary',
              )}
              onClick={() => setActiveTab('global')}
            >
              Global
            </button>
            <button
              type="button"
              data-testid="dictation-dictionary-tab-project"
              aria-pressed={activeTab === 'project'}
              className={cn(
                'h-8 rounded-[6px] px-3 text-[13px]',
                focusRing,
                activeTab === 'project'
                  ? 'bg-selected font-medium text-project-title'
                  : 'text-ink-secondary',
              )}
              onClick={() => setActiveTab('project')}
            >
              Project
            </button>
          </fieldset>

          {/* Project Selector when on Project tab */}
          {activeTab === 'project' && projects.length > 0 ? (
            <div className="flex items-center gap-2">
              <label
                htmlFor="dictation-dictionary-project-select"
                className="text-xs text-ink-muted"
              >
                Project:
              </label>
              <select
                id="dictation-dictionary-project-select"
                data-testid="dictation-dictionary-project-select"
                value={selectedProjectId ?? ''}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="rounded border border-edge bg-highlight px-2 py-0.5 text-xs text-ink"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <span className="ml-auto font-mono text-xs text-ink-muted">
            {!loading && !loadFailed && !legacyError
              ? `${filteredEntries.length} ${filteredEntries.length === 1 ? 'entry' : 'entries'}`
              : null}
          </span>
          <button
            type="button"
            data-testid="dictation-dictionary-refresh"
            aria-label="Refresh dictionary"
            title="Refresh dictionary"
            disabled={loading}
            onClick={() => setRefreshTrigger((val) => val + 1)}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-secondary hover:bg-highlight hover:text-ink disabled:opacity-50',
              focusRing,
            )}
          >
            <Icon.retry size={15} aria-hidden />
          </button>
        </div>

        {/* Add / Edit Form Modal / Box */}
        {isFormOpen ? (
          <form
            onSubmit={handleSaveForm}
            data-testid="dictation-dictionary-form"
            className="space-y-3 rounded-md border border-edge bg-highlight/40 p-3"
          >
            <h4 className="text-xs font-semibold text-ink">
              {editingId ? 'Edit Dictionary Term' : 'Add Dictionary Term'}
            </h4>

            {formError ? (
              <div role="alert" className="text-xs text-error">
                {formError}
              </div>
            ) : null}

            <div className="space-y-2">
              <div>
                <label htmlFor="dictation-form-term" className="block text-xs font-medium text-ink">
                  Term
                </label>
                <input
                  id="dictation-form-term"
                  type="text"
                  data-testid="dictation-dictionary-term-input"
                  value={formTerm}
                  onChange={(e) => setFormTerm(e.target.value)}
                  placeholder="e.g. Kubernetes, Vitest, NeKode"
                  className="w-full rounded border border-edge bg-highlight px-2.5 py-1 text-xs text-ink"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="dictation-form-aliases"
                  className="block text-xs font-medium text-ink"
                >
                  Phonetic Aliases (comma-separated)
                </label>
                <input
                  id="dictation-form-aliases"
                  type="text"
                  data-testid="dictation-dictionary-aliases-input"
                  value={formAliases}
                  onChange={(e) => setFormAliases(e.target.value)}
                  placeholder="e.g. k8s, kube, coober-netties"
                  className="w-full rounded border border-edge bg-highlight px-2.5 py-1 text-xs text-ink"
                />
              </div>

              <div>
                <label
                  htmlFor="dictation-form-description"
                  className="block text-xs font-medium text-ink"
                >
                  Description (optional)
                </label>
                <input
                  id="dictation-form-description"
                  type="text"
                  data-testid="dictation-dictionary-desc-input"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Brief explanation or domain note"
                  className="w-full rounded border border-edge bg-highlight px-2.5 py-1 text-xs text-ink"
                />
              </div>

              {!editingId ? (
                <div className="flex items-center gap-3">
                  <div>
                    <label
                      htmlFor="dictation-form-scope"
                      className="block text-xs font-medium text-ink"
                    >
                      Scope
                    </label>
                    <select
                      id="dictation-form-scope"
                      data-testid="dictation-dictionary-scope-select"
                      value={formScope}
                      onChange={(e) => setFormScope(e.target.value as 'global' | 'project')}
                      className="rounded border border-edge bg-highlight px-2 py-1 text-xs text-ink"
                    >
                      <option value="global">Global</option>
                      <option value="project">Project</option>
                    </select>
                  </div>

                  {formScope === 'project' && projects.length > 0 ? (
                    <div>
                      <label
                        htmlFor="dictation-form-project"
                        className="block text-xs font-medium text-ink"
                      >
                        Project
                      </label>
                      <select
                        id="dictation-form-project"
                        data-testid="dictation-dictionary-form-project"
                        value={formProjectId ?? selectedProjectId ?? ''}
                        onChange={(e) => setFormProjectId(e.target.value)}
                        className="rounded border border-edge bg-highlight px-2 py-1 text-xs text-ink"
                      >
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                data-testid="dictation-dictionary-save-button"
                disabled={formSaving}
                className="rounded bg-button px-3 py-1 text-xs font-medium text-ink hover:bg-button-hover disabled:opacity-50"
              >
                {formSaving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Term'}
              </button>
              <button
                type="button"
                data-testid="dictation-dictionary-cancel-button"
                onClick={() => setIsFormOpen(false)}
                className="rounded border border-edge px-3 py-1 text-xs text-ink-secondary hover:bg-highlight"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {/* Status & Messages */}
        {deleteError ? (
          <p
            role="alert"
            data-testid="dictation-dictionary-delete-error"
            className="border-t border-edge px-4 py-2 text-xs text-error"
          >
            {deleteError}
          </p>
        ) : null}
        <div aria-live="polite">
          {loading ? (
            <p className="text-xs text-ink-muted">Loading dictionary...</p>
          ) : loadFailed ? (
            <p
              role="alert"
              data-error-kind="load-failed"
              data-error-code="load-failed"
              className="text-xs text-error"
            >
              The dictionary could not load. Refresh to try again.
            </p>
          ) : legacyError ? (
            <p
              role="alert"
              data-error-kind={DICTATION_DICTIONARY_ERROR_TABLE[legacyError].kind}
              data-error-code={DICTATION_DICTIONARY_ERROR_TABLE[legacyError].code}
              className="text-xs text-error"
            >
              {DICTATION_DICTIONARY_ERROR_TABLE[legacyError].message}
            </p>
          ) : (
            <div>
              {filteredEntries.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 border-t border-edge px-4 py-7 text-center">
                  <Icon.book size={22} aria-hidden className="text-ink-muted" />
                  <p
                    data-testid="dictation-dictionary-empty"
                    className="text-[13px] text-ink-secondary"
                  >
                    No dictionary entries in this scope.
                  </p>
                </div>
              ) : (
                <ul className="max-h-60 overflow-auto border-t border-edge">
                  {filteredEntries.map((entry) => (
                    <li
                      key={entry.id}
                      data-testid={`dictation-entry-${entry.id}`}
                      className="flex items-start justify-between gap-3 border-t border-edge px-4 py-3 text-xs first:border-t-0"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <SwitchControl
                            checked={entry.enabled}
                            label={`Enable ${entry.term}`}
                            testId={`dictation-toggle-${entry.id}`}
                            onChange={() => handleToggle(entry)}
                          />
                          <span
                            data-testid={`dictation-term-${entry.id}`}
                            className={`font-medium ${entry.enabled ? 'text-ink' : 'text-ink-muted line-through'}`}
                          >
                            {entry.term}
                          </span>
                          <span className="rounded bg-highlight px-1.5 py-0.2 text-[10px] text-ink-muted uppercase">
                            {entry.scope}
                          </span>
                        </div>

                        {entry.aliases && entry.aliases.length > 0 ? (
                          <div
                            data-testid={`dictation-aliases-${entry.id}`}
                            className="pl-5 text-ink-muted"
                          >
                            Aliases: {entry.aliases.join(', ')}
                          </div>
                        ) : null}

                        {entry.description ? (
                          <div
                            data-testid={`dictation-desc-${entry.id}`}
                            className="pl-5 text-ink-secondary"
                          >
                            {entry.description}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          data-testid={`dictation-edit-${entry.id}`}
                          onClick={() => handleOpenEdit(entry)}
                          className={cn(
                            'inline-flex h-8 items-center rounded-[6px] px-2 text-xs text-ink hover:bg-highlight',
                            focusRing,
                          )}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          data-testid={`dictation-delete-${entry.id}`}
                          onClick={() => handleDelete(entry.id)}
                          className={cn(
                            'inline-flex h-8 items-center rounded-[6px] px-2 text-xs text-error hover:bg-highlight',
                            focusRing,
                          )}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </GroupBox>
    </section>
  )
}
