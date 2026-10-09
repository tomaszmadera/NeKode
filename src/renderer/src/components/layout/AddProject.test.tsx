import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppApi } from '../../../../shared/ipc-contract'
import { AddProject } from './AddProject'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  })
})
afterEach(cleanup)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function setup() {
  const project = { id: 'project', name: 'My Project', path: 'D:/project', runtimeLabel: null }
  const add = vi.fn().mockResolvedValue(project)
  const addWsl = vi.fn().mockResolvedValue(project)
  const wslDistributions = vi.fn().mockResolvedValue(['Ubuntu', 'Debian'])
  const wslDirectories = vi.fn().mockResolvedValue([])
  const app = { projects: { add, addWsl, wslDistributions, wslDirectories } } as unknown as AppApi
  const onAdded = vi.fn()
  const onClose = vi.fn()
  const view = render(<AddProject app={app} onAdded={onAdded} onClose={onClose} />)
  return { ...view, app, add, addWsl, wslDistributions, wslDirectories, onAdded, onClose, project }
}

function selectWsl() {
  fireEvent.change(screen.getByLabelText('Project location'), { target: { value: 'wsl' } })
}

async function readyWsl() {
  selectWsl()
  await screen.findByRole('option', { name: 'Ubuntu' })
}

function enterPath(path: string) {
  fireEvent.change(screen.getByLabelText('Linux project directory'), { target: { value: path } })
}

function cancelEscape() {
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }))
}

describe('Add Project', () => {
  it('starts on the keyboard location selector with only implemented choices and lazy discovery', () => {
    const { add, wslDistributions } = setup()
    expect(document.activeElement).toBe(screen.getByLabelText('Project location'))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Local',
      'WSL',
    ])
    expect(screen.getByRole('button', { name: 'Choose folder...' })).toBeTruthy()
    expect(add).not.toHaveBeenCalled()
    expect(wslDistributions).not.toHaveBeenCalled()
  })

  it('uses the Local picker only on submission and closes after project selection', async () => {
    const { add, onAdded, onClose, project } = setup()
    const form = screen.getByRole('button', { name: 'Choose folder...' }).closest('form')
    if (!form) throw new Error('Missing project form')
    fireEvent.submit(form)
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(add).toHaveBeenCalledOnce()
    expect(onAdded).toHaveBeenCalledWith(project)
  })

  it('keeps Local picker cancellation in the dialog and restores action focus', async () => {
    const { add, onAdded, onClose } = setup()
    add.mockResolvedValue(null)
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder...' }))
    await waitFor(() => expect(add).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose folder...' })),
    )
    expect(onAdded).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows Local registration errors without closing or changing selection', async () => {
    const { add, onAdded, onClose } = setup()
    add.mockRejectedValue({
      nekodeAppError: true,
      code: 'validation',
      message: 'Directory does not exist.',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder...' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Directory does not exist.')
    expect(onAdded).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('restores the connected invoking control after Cancel unmounts the dialog', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { unmount, onClose, add, addWsl } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    unmount()
    expect(document.activeElement).toBe(opener)
    expect(add).not.toHaveBeenCalled()
    expect(addWsl).not.toHaveBeenCalled()
    opener.remove()
  })

  it('allows Escape during discovery and ignores completion after unmount', async () => {
    const { wslDistributions, onClose, unmount, addWsl } = setup()
    const pending = deferred<string[]>()
    wslDistributions.mockReturnValue(pending.promise)
    selectWsl()
    expect(screen.getByRole('status').textContent).toContain('Loading distributions')
    cancelEscape()
    expect(onClose).toHaveBeenCalledOnce()
    unmount()
    await act(async () => pending.resolve(['Late']))
    expect(addWsl).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps Local usable when a stale WSL discovery completes', async () => {
    const { wslDistributions, add } = setup()
    const pending = deferred<string[]>()
    wslDistributions.mockReturnValue(pending.promise)
    selectWsl()
    expect(
      (screen.getByRole('button', { name: 'Add Project' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.change(screen.getByLabelText('Project location'), { target: { value: 'local' } })
    await act(async () => pending.resolve([]))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder...' }))
    await waitFor(() => expect(add).toHaveBeenCalledOnce())
  })

  it('shows no distributions and can retry detection', async () => {
    const { wslDistributions, addWsl } = setup()
    wslDistributions.mockResolvedValueOnce([])
    selectWsl()
    expect((await screen.findByRole('alert')).textContent).toContain(
      'No WSL distributions are installed',
    )
    expect(
      (screen.getByRole('button', { name: 'Add Project' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('option', { name: 'Ubuntu' })
    expect(wslDistributions).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(addWsl).not.toHaveBeenCalled()
  })

  it('shows discovery errors and retries without stealing focus', async () => {
    const { wslDistributions } = setup()
    wslDistributions.mockRejectedValueOnce({
      nekodeAppError: true,
      code: 'validation',
      message: 'WSL is unavailable.',
    })
    selectWsl()
    expect((await screen.findByRole('alert')).textContent).toBe('WSL is unavailable.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('option', { name: 'Ubuntu' })
    expect(document.activeElement).toBe(screen.getByLabelText('Project location'))
  })

  it('adds the chosen distribution and exact Linux path', async () => {
    const { addWsl, add, onAdded, onClose, project } = setup()
    await readyWsl()
    fireEvent.change(screen.getByLabelText('Distribution'), { target: { value: 'Debian' } })
    enterPath('/home/user/My $ Project')
    fireEvent.click(screen.getByRole('button', { name: 'Add Project' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(addWsl).toHaveBeenCalledWith('Debian', '/home/user/My $ Project')
    expect(onAdded).toHaveBeenCalledWith(project)
    expect(add).not.toHaveBeenCalled()
  })

  it.each(['', '/', 'relative/path', '/home/../project', '/home//project', '/home/project/'])(
    'blocks invalid Linux path %j before IPC and focuses the associated error',
    async (path) => {
      const { addWsl, onAdded } = setup()
      await readyWsl()
      enterPath(path)
      fireEvent.click(screen.getByRole('button', { name: 'Add Project' }))
      const input = screen.getByLabelText('Linux project directory')
      expect(screen.getByRole('alert').id).toBe('wsl-path-error')
      expect(input.getAttribute('aria-invalid')).toBe('true')
      expect(input.getAttribute('aria-describedby')).toContain('wsl-path-error')
      expect(document.activeElement).toBe(input)
      expect(addWsl).not.toHaveBeenCalled()
      expect(onAdded).not.toHaveBeenCalled()
    },
  )

  it('preserves WSL path and distribution when switching Local and back', async () => {
    setup()
    await readyWsl()
    fireEvent.change(screen.getByLabelText('Distribution'), { target: { value: 'Debian' } })
    enterPath('/home/user/my project')
    fireEvent.change(screen.getByLabelText('Project location'), { target: { value: 'local' } })
    await readyWsl()
    expect((screen.getByLabelText('Distribution') as HTMLSelectElement).value).toBe('Debian')
    expect((screen.getByLabelText('Linux project directory') as HTMLInputElement).value).toBe(
      '/home/user/my project',
    )
  })

  it('keeps registration failure and inputs visible for correction', async () => {
    const { addWsl, onAdded, onClose } = setup()
    addWsl.mockRejectedValueOnce({
      nekodeAppError: true,
      code: 'validation',
      message: 'Directory does not exist.',
    })
    await readyWsl()
    enterPath('/missing')
    fireEvent.click(screen.getByRole('button', { name: 'Add Project' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Directory does not exist.')
    expect((screen.getByLabelText('Linux project directory') as HTMLInputElement).value).toBe(
      '/missing',
    )
    expect(onAdded).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    enterPath('/home/user/project')
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add Project' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it.each(['local', 'wsl'])(
    'blocks duplicate submission and Escape while %s registration is pending',
    async (location) => {
      const { add, addWsl, onClose, project } = setup()
      const pending = deferred<typeof project>()
      if (location === 'wsl') {
        addWsl.mockReturnValue(pending.promise)
        await readyWsl()
        enterPath('/home/user/project')
      } else add.mockReturnValue(pending.promise)
      const action = screen.getByRole('button', {
        name: location === 'wsl' ? 'Add Project' : 'Choose folder...',
      })
      const form = action.closest('form')
      if (!form) throw new Error('Missing project form')
      fireEvent.submit(form)
      fireEvent.submit(form)
      cancelEscape()
      expect(screen.getByRole('status').textContent).toContain('Wait for this step')
      expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(
        true,
      )
      expect((screen.getByLabelText('Project location') as HTMLSelectElement).disabled).toBe(true)
      expect(onClose).not.toHaveBeenCalled()
      expect(location === 'wsl' ? addWsl : add).toHaveBeenCalledOnce()
      await act(async () => pending.resolve(project))
      expect(onClose).toHaveBeenCalledOnce()
    },
  )

  it('retries opening an already registered project without invoking registration again', async () => {
    const { onAdded, onClose, add, project } = setup()
    onAdded.mockRejectedValueOnce(new Error('list failed'))
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder...' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Unable to open the added project.')
    expect(
      screen.getByText('The project was added. Retry opening it without adding it again.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry opening project' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(add).toHaveBeenCalledOnce()
    expect(onAdded).toHaveBeenNthCalledWith(2, project)
  })
})

describe('WSL directory combobox', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  async function prepare() {
    const result = setup()
    await act(async () => selectWsl())
    const input = screen.getByRole('combobox', {
      name: 'Linux project directory',
    }) as HTMLInputElement
    act(() => input.focus())
    return { ...result, input }
  }

  async function debounce() {
    await act(async () => vi.advanceTimersByTimeAsync(200))
  }

  it('debounces input and announces loading, empty and errors separately without moving focus', async () => {
    const { input, wslDirectories } = await prepare()
    enterPath('relative')
    await debounce()
    expect(wslDirectories).not.toHaveBeenCalled()
    enterPath('/home/a')
    enterPath('/home/al')
    expect(screen.getByRole('status').textContent).toBe('Loading directories...')
    expect(wslDirectories).not.toHaveBeenCalled()
    await debounce()
    expect(wslDirectories).toHaveBeenCalledExactlyOnceWith('Ubuntu', '/home/al')
    expect(screen.getByRole('status').textContent).toBe('No matching directories.')
    wslDirectories.mockRejectedValueOnce({
      nekodeAppError: true,
      code: 'unknown',
      message: 'Parent unavailable.',
    })
    enterPath('/missing/')
    await debounce()
    expect(screen.getByRole('alert').textContent).toBe('Parent unavailable.')
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.activeElement).toBe(input)
  })

  it('accepts keyboard and pointer choices without registering and keeps navigation available', async () => {
    const { input, wslDirectories, addWsl } = await prepare()
    wslDirectories.mockResolvedValue(['/home/alpha', '/home/beta'])
    enterPath('/home/')
    await debounce()
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id)
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(false)
    expect(input.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: '/home/beta' }).id,
    )
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false)
    expect(input.value).toBe('/home/beta')
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false)
    expect(input.value).toBe('/home/alpha')
    expect(document.activeElement).toBe(input)
    const beta = screen.getByRole('option', { name: '/home/beta' })
    fireEvent.mouseDown(beta)
    fireEvent.click(beta)
    expect(input.value).toBe('/home/beta')
    expect(addWsl).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(input)
    enterPath('/home/beta/')
    await debounce()
    expect(wslDirectories).toHaveBeenLastCalledWith('Ubuntu', '/home/beta/')
  })

  it('Escape closes the list, closed Tab/Enter retain defaults, and arrows reopen it', async () => {
    const { input, wslDirectories, onClose } = await prepare()
    wslDirectories.mockResolvedValue(['/home/project'])
    enterPath('/home/')
    await debounce()
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true)
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })).toBe(true)
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true)
  })

  it('drops superseded input responses before the next debounce finishes', async () => {
    const { input, wslDirectories } = await prepare()
    const first = deferred<string[]>()
    wslDirectories.mockReturnValueOnce(first.promise).mockResolvedValueOnce(['/new/project'])
    enterPath('/old/')
    await debounce()
    enterPath('/new/')
    await act(async () => first.resolve(['/old/project']))
    expect(screen.queryByRole('listbox')).toBeNull()
    await debounce()
    expect(screen.getByRole('option', { name: '/new/project' })).toBeTruthy()
    expect(input.value).toBe('/new/')
  })

  it('ignores a superseded rejection while the newer query is loading', async () => {
    const { wslDirectories } = await prepare()
    const old = deferred<string[]>()
    wslDirectories.mockReturnValueOnce(old.promise)
    enterPath('/old/')
    await debounce()
    enterPath('/new/')
    await act(async () =>
      old.reject({ nekodeAppError: true, code: 'unknown', message: 'Old failure.' }),
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Loading directories...')
    await debounce()
    expect(screen.getByRole('status').textContent).toBe('No matching directories.')
  })

  it('refreshes the distribution after accepting an unchanged field value', async () => {
    const { input, wslDirectories } = await prepare()
    wslDirectories
      .mockResolvedValueOnce(['/home/project'])
      .mockResolvedValueOnce(['/home/project-debian'])
    enterPath('/home/project')
    await debounce()
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('Distribution'), { target: { value: 'Debian' } })
    expect(screen.queryByRole('listbox')).toBeNull()
    await debounce()
    expect(wslDirectories).toHaveBeenLastCalledWith('Debian', '/home/project')
    expect(screen.queryByRole('option', { name: '/home/project' })).toBeNull()
  })

  it('drops old distribution results and never reopens the list after blur', async () => {
    const { input, wslDirectories } = await prepare()
    const old = deferred<string[]>()
    wslDirectories.mockReturnValueOnce(old.promise).mockResolvedValueOnce(['/home/debian'])
    enterPath('/home/')
    await debounce()
    fireEvent.change(screen.getByLabelText('Distribution'), { target: { value: 'Debian' } })
    await act(async () => old.resolve(['/home/ubuntu']))
    act(() => screen.getByRole('button', { name: 'Cancel' }).focus())
    await debounce()
    expect(wslDirectories).toHaveBeenLastCalledWith('Debian', '/home/')
    expect(screen.queryByRole('listbox')).toBeNull()
    act(() => input.focus())
    expect(screen.getByRole('option', { name: '/home/debian' })).toBeTruthy()
  })

  it.each(['local', 'unmount'])('ignores completion after %s', async (action) => {
    const { wslDirectories, unmount } = await prepare()
    const pending = deferred<string[]>()
    wslDirectories.mockReturnValueOnce(pending.promise)
    enterPath('/home/')
    await debounce()
    if (action === 'local')
      fireEvent.change(screen.getByLabelText('Project location'), { target: { value: 'local' } })
    else unmount()
    await act(async () => pending.resolve(['/home/late']))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
