import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DictationDictionaryEntry,
  DictationDictionaryError,
} from '../../../../shared/dictation-contract'
import type { ProjectInfo } from '../../../../shared/ipc-contract'
import { createDictationApiStub } from '../../test/dictation-api-stub'
import { DICTATION_DICTIONARY_ERROR_TABLE, DictationDictionary } from './DictationDictionary'

const sampleGlobalEntry: DictationDictionaryEntry = {
  id: 'd1',
  term: 'Kubernetes',
  aliases: ['k8s', 'kube'],
  description: 'Container orchestration',
  scope: 'global',
  projectId: null,
  enabled: true,
  createdAt: '2026-10-25T10:00:00Z',
  updatedAt: '2026-10-25T10:00:00Z',
}

const sampleProjectEntry: DictationDictionaryEntry = {
  id: 'd2',
  term: 'Vitest',
  aliases: ['vite-test'],
  description: 'Test runner',
  scope: 'project',
  projectId: 'proj-1',
  enabled: true,
  createdAt: '2026-10-25T10:00:00Z',
  updatedAt: '2026-10-25T10:00:00Z',
}

const sampleProjects: ProjectInfo[] = [
  { id: 'proj-1', name: 'NeKode Core', path: '/nekode', runtimeLabel: null },
  { id: 'proj-2', name: 'NeKode Docs', path: '/docs', runtimeLabel: null },
]

afterEach(cleanup)

describe('DictationDictionary (Modernized CRUD)', () => {
  it('renders dictionary entries, count, and aliases under the Global tab', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.dictionaryList).mockResolvedValue([sampleGlobalEntry])

    render(<DictationDictionary api={api} />)

    await screen.findByText('Kubernetes')
    expect(screen.getByText('1 entry')).toBeTruthy()
    expect(screen.getByText('Aliases: k8s, kube')).toBeTruthy()
    expect(screen.getByText('Container orchestration')).toBeTruthy()
    expect(screen.getByRole('switch', { checked: true })).toBeTruthy()
  })

  it('displays empty message when no terms exist in the selected scope', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.dictionaryList).mockResolvedValue([])

    render(<DictationDictionary api={api} />)

    await screen.findByText('0 entries')
    expect(screen.getByTestId('dictation-dictionary-empty')).toBeTruthy()
  })

  it('switches between Global and Project tabs and filters by project', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.dictionaryList).mockImplementation(async (projectId) => {
      if (projectId === 'proj-1') return [sampleProjectEntry]
      return [sampleGlobalEntry]
    })

    render(<DictationDictionary api={api} projects={sampleProjects} projectId="proj-1" />)

    // Initial global tab shows global entry
    await screen.findByText('Kubernetes')
    expect(screen.queryByText('Vitest')).toBeNull()

    // Switch to Project tab
    fireEvent.click(screen.getByTestId('dictation-dictionary-tab-project'))

    await screen.findByText('Vitest')
    expect(screen.queryByText('Kubernetes')).toBeNull()
    expect(screen.getByText('Aliases: vite-test')).toBeTruthy()
    expect(api.dictionaryList).toHaveBeenCalledWith('proj-1')
  })

  it('toggles a dictionary term enabled status via dictionaryToggle', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.dictionaryList).mockResolvedValue([sampleGlobalEntry])
    vi.mocked(api.dictionaryToggle).mockResolvedValue({
      ...sampleGlobalEntry,
      enabled: false,
    })

    render(<DictationDictionary api={api} />)

    await screen.findByText('Kubernetes')
    const toggle = screen.getByTestId(`dictation-toggle-${sampleGlobalEntry.id}`)
    expect(toggle.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(toggle)

    await waitFor(() => {
      expect(api.dictionaryToggle).toHaveBeenCalledWith(sampleGlobalEntry.id, false)
    })
  })

  it('adds a new dictionary term with comma-separated phonetic aliases', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.dictionaryList).mockResolvedValue([])
    const newEntry: DictationDictionaryEntry = {
      id: 'd-new',
      term: 'TypeScript',
      aliases: ['ts', 'type script'],
      description: 'Typed JavaScript',
      scope: 'global',
      projectId: null,
      enabled: true,
      createdAt: '2026-10-25T11:00:00Z',
      updatedAt: '2026-10-25T11:00:00Z',
    }
    vi.mocked(api.dictionaryAdd).mockResolvedValue(newEntry)

    render(<DictationDictionary api={api} />)

    await screen.findByText('0 entries')
    fireEvent.click(screen.getByTestId('dictation-dictionary-add-button'))

    // Form is visible
    expect(screen.getByTestId('dictation-dictionary-form')).toBeTruthy()

    // Fill in form
    fireEvent.change(screen.getByTestId('dictation-dictionary-term-input'), {
      target: { value: 'TypeScript' },
    })
    fireEvent.change(screen.getByTestId('dictation-dictionary-aliases-input'), {
      target: { value: 'ts, type script' },
    })
    fireEvent.change(screen.getByTestId('dictation-dictionary-desc-input'), {
      target: { value: 'Typed JavaScript' },
    })

    fireEvent.click(screen.getByTestId('dictation-dictionary-save-button'))

    await waitFor(() => {
      expect(api.dictionaryAdd).toHaveBeenCalledWith({
        term: 'TypeScript',
        aliases: ['ts', 'type script'],
        description: 'Typed JavaScript',
        scope: 'global',
        projectId: null,
        enabled: true,
      })
    })

    await screen.findByText('TypeScript')
    expect(screen.getByText('Aliases: ts, type script')).toBeTruthy()
  })

  it('edits an existing dictionary term and updates its phonetic aliases', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.dictionaryList).mockResolvedValue([sampleGlobalEntry])
    const updatedEntry: DictationDictionaryEntry = {
      ...sampleGlobalEntry,
      term: 'K8s Extended',
      aliases: ['kube', 'cloud-native'],
      description: 'Updated container orchestration',
    }
    vi.mocked(api.dictionaryUpdate).mockResolvedValue(updatedEntry)

    render(<DictationDictionary api={api} />)

    await screen.findByText('Kubernetes')
    fireEvent.click(screen.getByTestId(`dictation-edit-${sampleGlobalEntry.id}`))

    // Form is pre-populated
    const termInput = screen.getByTestId('dictation-dictionary-term-input') as HTMLInputElement
    expect(termInput.value).toBe('Kubernetes')
    const aliasesInput = screen.getByTestId(
      'dictation-dictionary-aliases-input',
    ) as HTMLInputElement
    expect(aliasesInput.value).toBe('k8s, kube')

    // Edit values
    fireEvent.change(termInput, { target: { value: 'K8s Extended' } })
    fireEvent.change(aliasesInput, { target: { value: 'kube, cloud-native' } })
    fireEvent.change(screen.getByTestId('dictation-dictionary-desc-input'), {
      target: { value: 'Updated container orchestration' },
    })

    fireEvent.click(screen.getByTestId('dictation-dictionary-save-button'))

    await waitFor(() => {
      expect(api.dictionaryUpdate).toHaveBeenCalledWith(sampleGlobalEntry.id, {
        term: 'K8s Extended',
        aliases: ['kube', 'cloud-native'],
        description: 'Updated container orchestration',
      })
    })

    await screen.findByText('K8s Extended')
    expect(screen.getByText('Aliases: kube, cloud-native')).toBeTruthy()
  })

  it('deletes a dictionary term via dictionaryDelete', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.dictionaryList).mockResolvedValue([sampleGlobalEntry])
    vi.mocked(api.dictionaryDelete).mockResolvedValue()

    render(<DictationDictionary api={api} />)

    await screen.findByText('Kubernetes')
    fireEvent.click(screen.getByTestId(`dictation-delete-${sampleGlobalEntry.id}`))

    await waitFor(() => {
      expect(api.dictionaryDelete).toHaveBeenCalledWith(sampleGlobalEntry.id)
    })
    expect(screen.queryByText('Kubernetes')).toBeNull()
  })

  it('cancels add/edit form without calling API', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.dictionaryList).mockResolvedValue([])

    render(<DictationDictionary api={api} />)

    await screen.findByText('0 entries')
    fireEvent.click(screen.getByTestId('dictation-dictionary-add-button'))
    expect(screen.getByTestId('dictation-dictionary-form')).toBeTruthy()

    fireEvent.click(screen.getByTestId('dictation-dictionary-cancel-button'))
    expect(screen.queryByTestId('dictation-dictionary-form')).toBeNull()
    expect(api.dictionaryAdd).not.toHaveBeenCalled()
  })

  // Machine-readable error kind assertions across dictionary error codes
  const ALL_DICTIONARY_ERRORS: readonly DictationDictionaryError[] = [
    'bridge-missing',
    'bridge-invalid',
    'unreachable',
    'auth-failed',
    'malformed-response',
    'unsupported-pagination',
    'dictionary-limit',
  ]

  it.each(ALL_DICTIONARY_ERRORS)(
    'exposes machine-readable error kind and code for %s in the alert',
    async (error) => {
      const api = createDictationApiStub()
      vi.mocked(api.dictionaryList).mockResolvedValue({
        state: 'unavailable',
        error,
      } as unknown as DictationDictionaryEntry[])
      render(<DictationDictionary api={api} />)
      const alert = await screen.findByRole('alert')
      expect(alert.getAttribute('data-error-kind')).toBe(error)
      expect(alert.getAttribute('data-error-code')).toBe(error)
      expect(alert.textContent).toBeTruthy()
    },
  )

  it('verifies that the dictionary error mapping table defines all error codes', () => {
    for (const error of ALL_DICTIONARY_ERRORS) {
      const entry = DICTATION_DICTIONARY_ERROR_TABLE[error]
      expect(entry.kind).toBe(error)
      expect(entry.code).toBe(error)
      expect(entry.message.length).toBeGreaterThan(0)
    }
  })

  it('sanitizes IPC failure and handles unmount cleanly', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.dictionaryList).mockRejectedValueOnce(new Error('private transport error'))
    const view = render(<DictationDictionary api={api} />)
    const alert = await screen.findByRole('alert')
    expect(alert.getAttribute('data-error-kind')).toBe('load-failed')
    expect(screen.queryByText(/private transport/)).toBeNull()
    view.unmount()
  })
})
