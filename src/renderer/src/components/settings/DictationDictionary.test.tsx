import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DictationDictionaryError } from '../../../../shared/dictation-contract'
import type { AppApi } from '../../../../shared/ipc-contract'
import { useDesktopDictation } from '../../hooks/useDesktopDictation'
import { createDictationApiStub } from '../../test/dictation-api-stub'
import { DICTATION_DICTIONARY_ERROR_TABLE, DictationDictionary } from './DictationDictionary'

afterEach(cleanup)
describe('read-only OpenWhispr dictionary', () => {
  it('loads while desktop is disabled, shows count and raw text with no editor or activation', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.dictionaryList).mockResolvedValue({
      state: 'ready',
      terms: [' NeKode ', '<b>raw</b>'],
    })
    const view = render(<DictationDictionary api={api} />)
    await screen.findByText('2 entries')
    expect(screen.getByText('<b>raw</b>').querySelector('b')).toBeNull()
    expect(view.container.querySelector('li')?.textContent).toBe(' NeKode ')
    expect(screen.getByText(/OpenWhispr manages/)).toBeTruthy()
    expect(screen.getByText(/Local bridge only/)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(api.desktopActivate).not.toHaveBeenCalled()
    expect(api.setSettings).not.toHaveBeenCalled()
  })
  it('distinguishes loading and empty and serializes explicit refresh', async () => {
    const api = createDictationApiStub()
    let complete!: (value: Awaited<ReturnType<typeof api.dictionaryList>>) => void
    vi.mocked(api.dictionaryList).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    render(<DictationDictionary api={api} />)
    expect(screen.getByText('Loading dictionary...')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh dictionary' }))
    expect(api.dictionaryList).toHaveBeenCalledOnce()
    await act(async () => complete({ state: 'ready', terms: [] }))
    expect(screen.getByText('0 entries')).toBeTruthy()
    expect(screen.getByText('The OpenWhispr dictionary is empty.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh dictionary' }))
    expect(api.dictionaryList).toHaveBeenCalledTimes(2)
    await act(async () => complete({ state: 'ready', terms: [] }))
  })
  it.each([200, 201])(
    'shows the complete count for %s entries and caps the displayed list',
    async (count) => {
      const api = createDictationApiStub()
      const terms = Array.from({ length: count }, (_, index) => `term ${index % 100}`)
      vi.mocked(api.dictionaryList).mockResolvedValue({ state: 'ready', terms })
      render(<DictationDictionary api={api} />)
      await screen.findByText(`${count} entries`)
      expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(
        terms.slice(0, 200),
      )
      expect(screen.queryByText(`Showing the first 200 of ${count} entries.`) !== null).toBe(
        count > 200,
      )
      expect(api.dictionaryList).toHaveBeenCalledOnce()
    },
  )
  it('clears a previous complete dictionary while refreshing and after an incomplete response', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.dictionaryList).mockResolvedValueOnce({ state: 'ready', terms: ['old term'] })
    let complete!: (value: Awaited<ReturnType<typeof api.dictionaryList>>) => void
    vi.mocked(api.dictionaryList).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    render(<DictationDictionary api={api} />)
    await screen.findByText('old term')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh dictionary' }))
    expect(screen.getByText('Loading dictionary...')).toBeTruthy()
    expect(screen.queryByRole('listitem')).toBeNull()
    await act(async () => complete({ state: 'unavailable', error: 'unsupported-pagination' }))
    const alert = screen.getByRole('alert')
    expect(alert.getAttribute('data-error-kind')).toBe('unsupported-pagination')
    expect(alert.getAttribute('data-error-code')).toBe('unsupported-pagination')
    expect(alert.textContent).toBeTruthy()
    expect(screen.queryByText('old term')).toBeNull()
    expect(screen.queryByText('1 entry')).toBeNull()
  })

  // Machine-readable error kind assertions across all 7 dictionary error codes.
  // Tests assert the typed error kind/code and smoke-check that a non-empty
  // message exists, avoiding brittle pinning of user-facing copy strings.
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
      vi.mocked(api.dictionaryList).mockResolvedValue({ state: 'unavailable', error })
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

  it('shows an unavailable dictionary without disabling desktop readiness and supports manual retry', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.dictionaryList).mockResolvedValue({ state: 'unavailable', error: 'unreachable' })
    vi.mocked(api.desktopSetup).mockResolvedValue({
      supported: true,
      settings: { enabled: true, confirmed: true },
    })
    const hook = renderHook(() => useDesktopDictation({ dictation: api } as AppApi))
    render(<DictationDictionary api={api} />)
    const alert = await screen.findByRole('alert')
    expect(alert.getAttribute('data-error-kind')).toBe('unreachable')
    expect(alert.getAttribute('data-error-code')).toBe('unreachable')
    await waitFor(() => expect(hook.result.current.control.disabledReason).toBeNull())
    expect(screen.queryByText(/entries$/)).toBeNull()
    vi.mocked(api.dictionaryList).mockResolvedValue({ state: 'ready', terms: ['fixed'] })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh dictionary' }))
    await screen.findByText('1 entry')
    await act(async () => hook.result.current.control.activate())
    expect(api.desktopActivate).toHaveBeenCalledOnce()
    for (const call of [api.status, api.refreshModels, api.testConnection, api.start, api.audio])
      expect(call).not.toHaveBeenCalled()
  })
  it('sanitizes IPC failure and ignores a completion after unmount', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.dictionaryList).mockRejectedValueOnce(new Error('private transport detail'))
    const view = render(<DictationDictionary api={api} />)
    const alert = await screen.findByRole('alert')
    expect(alert.getAttribute('data-error-kind')).toBe('load-failed')
    expect(alert.getAttribute('data-error-code')).toBe('load-failed')
    expect(screen.queryByText(/private transport/)).toBeNull()
    let complete!: (value: Awaited<ReturnType<typeof api.dictionaryList>>) => void
    vi.mocked(api.dictionaryList).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh dictionary' }))
    view.unmount()
    await act(async () => complete({ state: 'ready', terms: ['late'] }))
    expect(screen.queryByText('late')).toBeNull()
  })
})
