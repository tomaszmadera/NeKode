import type { AppApi, ProjectInfo, SshProjectInput } from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import { type SshField, validateSshLocation } from '@shared/ssh-target'
import { wslProjectPath } from '@shared/wsl-path'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'

interface Props {
  app: AppApi
  onAdded: (project: ProjectInfo) => void | Promise<void>
  onClose: () => void
}

const controlClass =
  'mt-1 h-control w-full rounded-md border border-edge bg-app px-3 text-sm disabled:opacity-50'

export function AddProject({ app, onAdded, onClose }: Props): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const locationInput = useRef<HTMLSelectElement>(null)
  const pathInput = useRef<HTMLInputElement>(null)
  const sshHostInput = useRef<HTMLInputElement>(null)
  const sshUserInput = useRef<HTMLInputElement>(null)
  const sshPortInput = useRef<HTMLInputElement>(null)
  const sshPathInput = useRef<HTMLInputElement>(null)
  const primaryAction = useRef<HTMLButtonElement>(null)
  const alive = useRef(true)
  const requestId = useRef(0)
  const busyRef = useRef(false)
  const directoryRequestId = useRef(0)
  const directoryFocused = useRef(false)
  const directoriesDismissed = useRef(false)
  const acceptedPath = useRef<string | null>(null)
  const [location, setLocation] = useState('local')
  const [distributions, setDistributions] = useState<string[]>([])
  const [distribution, setDistribution] = useState('')
  const [path, setPath] = useState('')
  const [sshHost, setSshHost] = useState('')
  const [sshUser, setSshUser] = useState('')
  const [sshPort, setSshPort] = useState('')
  const [sshRemotePath, setSshRemotePath] = useState('')
  const [sshFieldErrors, setSshFieldErrors] = useState<Partial<Record<SshField, string>>>({})
  const [discovery, setDiscovery] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [pathError, setPathError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [registeredProject, setRegisteredProject] = useState<ProjectInfo | null>(null)
  const [directories, setDirectories] = useState<string[]>([])
  const [directoryState, setDirectoryState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  )
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const [directoriesOpen, setDirectoriesOpen] = useState(false)
  const [activeDirectory, setActiveDirectory] = useState(0)
  const wsl = location === 'wsl'
  const ssh = location === 'ssh'
  const remote = wsl || ssh
  const fieldsDisabled = busy || registeredProject !== null

  useEffect(() => {
    const id = ++directoryRequestId.current
    if (acceptedPath.current === path && wsl && !fieldsDisabled) {
      acceptedPath.current = null
      return
    }
    setDirectories([])
    setDirectoriesOpen(false)
    setDirectoryError(null)
    if (!wsl || fieldsDisabled || discovery !== 'ready' || !distribution || !path.startsWith('/')) {
      setDirectoryState('idle')
      return
    }
    setDirectoryState('loading')
    const timer = setTimeout(async () => {
      try {
        const paths = await app.projects.wslDirectories(distribution, path)
        if (!alive.current || id !== directoryRequestId.current) return
        setDirectories(paths)
        setActiveDirectory(0)
        setDirectoryState('ready')
        setDirectoriesOpen(
          paths.length > 0 && directoryFocused.current && !directoriesDismissed.current,
        )
      } catch (cause) {
        if (!alive.current || id !== directoryRequestId.current) return
        setDirectoryState('error')
        setDirectoryError(parseAppErrorPayload(cause)?.message ?? 'Unable to list WSL directories.')
      }
    }, 200)
    return () => {
      clearTimeout(timer)
      directoryRequestId.current += 1
    }
  }, [app.projects.wslDirectories, path, distribution, wsl, discovery, fieldsDisabled])

  useEffect(() => {
    if (directoriesOpen) {
      document
        .getElementById(`wsl-directory-option-${activeDirectory}`)
        ?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [activeDirectory, directoriesOpen])

  function acceptDirectory(value: string): void {
    acceptedPath.current = value === path ? null : value
    setPath(value)
    setPathError(null)
    setError(null)
  }

  useEffect(() => {
    const opener = document.activeElement
    alive.current = true
    dialog.current?.showModal()
    locationInput.current?.focus()
    return () => {
      alive.current = false
      requestId.current += 1
      dialog.current?.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  async function discover(): Promise<void> {
    const id = ++requestId.current
    setDiscovery('loading')
    setDiscoveryError(null)
    try {
      const names = await app.projects.wslDistributions()
      if (!alive.current || id !== requestId.current) return
      setDistributions(names)
      setDistribution((previous) => (names.includes(previous) ? previous : (names[0] ?? '')))
      setDiscovery('ready')
    } catch (cause) {
      if (!alive.current || id !== requestId.current) return
      setDiscovery('error')
      setDiscoveryError(parseAppErrorPayload(cause)?.message ?? 'Unable to list WSL distributions.')
    }
  }

  function focusSshField(field: SshField): void {
    const input =
      field === 'host'
        ? sshHostInput.current
        : field === 'user'
          ? sshUserInput.current
          : field === 'port'
            ? sshPortInput.current
            : sshPathInput.current
    input?.focus()
  }

  function sshInput(): SshProjectInput {
    const portText = sshPort.trim()
    return {
      host: sshHost,
      user: sshUser.length === 0 ? null : sshUser,
      port: portText.length === 0 ? null : Number(portText),
      path: sshRemotePath,
    }
  }

  async function add(): Promise<void> {
    if (busyRef.current) return
    if (!registeredProject && location === 'wsl') {
      if (discovery !== 'ready' || !distribution) return
      try {
        wslProjectPath(distribution, path)
      } catch (cause) {
        setPathError(
          cause instanceof Error ? cause.message : 'Use an absolute Linux project directory.',
        )
        pathInput.current?.focus()
        return
      }
    }
    if (!registeredProject && ssh) {
      // Number() would accept `0x16` or `1e3` as a port, so the port text must
      // be digits before it is converted.
      const portText = sshPort.trim()
      if (portText.length > 0 && !/^\d+$/u.test(portText)) {
        setSshFieldErrors({ port: 'The port must be a number from 1 to 65535.' })
        setError(null)
        focusSshField('port')
        return
      }
      const invalid = validateSshLocation(sshInput())
      if (invalid !== null) {
        setSshFieldErrors({ [invalid.field]: invalid.message })
        setError(null)
        focusSshField(invalid.field)
        return
      }
      setSshFieldErrors({})
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    let project = registeredProject
    try {
      if (!project) {
        project =
          location === 'local'
            ? await app.projects.add()
            : location === 'wsl'
              ? await app.projects.addWsl(distribution, path)
              : await app.projects.addSsh(sshInput())
        if (!alive.current) return
        if (project === null) {
          requestAnimationFrame(() => {
            if (alive.current) primaryAction.current?.focus()
          })
          return
        }
        setRegisteredProject(project)
      }
      await onAdded(project)
      if (alive.current) onClose()
    } catch (cause) {
      if (alive.current) {
        setError(
          parseAppErrorPayload(cause)?.message ??
            (project ? 'Unable to open the added project.' : 'Failed to add the project.'),
        )
      }
    } finally {
      busyRef.current = false
      if (alive.current) setBusy(false)
    }
  }

  const primaryLabel = registeredProject
    ? busy
      ? 'Opening project...'
      : 'Retry opening project'
    : busy
      ? remote
        ? 'Adding project...'
        : 'Choosing folder...'
      : remote
        ? 'Add Project'
        : 'Choose folder...'

  return (
    <dialog
      ref={dialog}
      aria-modal="true"
      aria-labelledby="add-project-title"
      aria-describedby="add-project-description"
      onCancel={(event) => {
        event.preventDefault()
        if (!busyRef.current) onClose()
      }}
      className="m-auto max-h-[90vh] w-[min(28rem,90vw)] overflow-y-auto rounded-lg border border-edge bg-panel p-5 text-ink shadow-xl backdrop:bg-black/70"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <h2 id="add-project-title" className="text-base font-semibold">
          Add Project
        </h2>
        <p id="add-project-description" className="mt-2 text-sm text-ink-secondary">
          Choose where your project is stored.
        </p>
        <label className="mt-4 block text-sm" htmlFor="project-location">
          Project location
        </label>
        <select
          ref={locationInput}
          id="project-location"
          value={location}
          disabled={fieldsDisabled}
          className={controlClass}
          onChange={(event) => {
            const next = event.target.value
            setLocation(next)
            setError(null)
            setPathError(null)
            if (next === 'wsl') void discover()
            else {
              requestId.current += 1
              setDiscovery('idle')
              setDiscoveryError(null)
            }
          }}
        >
          <option value="local">Local</option>
          {/* WSL projects exist only when NeKode runs on Windows (not on Linux, not inside WSL). */}
          {app.platform === undefined || app.platform === 'win32' ? (
            <option value="wsl">WSL</option>
          ) : null}
          {/* SSH projects work on every platform through the system OpenSSH client. */}
          <option value="ssh">SSH</option>
        </select>
        {wsl ? (
          <>
            {discovery === 'loading' ? (
              <p role="status" className="mt-3 text-sm text-ink-secondary">
                Loading distributions...
              </p>
            ) : null}
            {discoveryError || (discovery === 'ready' && distributions.length === 0) ? (
              <div className="mt-3">
                <p role="alert" className="text-sm text-ink">
                  {discoveryError ??
                    'No WSL distributions are installed. Install a distribution, then retry, or choose Local.'}
                </p>
                <button
                  type="button"
                  onClick={() => void discover()}
                  className="mt-2 h-control rounded-md bg-button px-3 text-sm hover:bg-button-hover"
                >
                  Retry
                </button>
              </div>
            ) : null}
            <label className="mt-4 block text-sm" htmlFor="wsl-distribution">
              Distribution
            </label>
            <select
              id="wsl-distribution"
              value={distribution}
              disabled={fieldsDisabled || discovery !== 'ready' || distributions.length === 0}
              onChange={(event) => {
                setDistribution(event.target.value)
                setError(null)
                setPathError(null)
              }}
              className={controlClass}
            >
              {distributions.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
            <label className="mt-4 block text-sm" htmlFor="wsl-directory">
              Linux project directory
            </label>
            <input
              ref={pathInput}
              id="wsl-directory"
              placeholder="/home/user/project"
              value={path}
              role="combobox"
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={directoriesOpen}
              aria-controls={directoriesOpen ? 'wsl-directories' : undefined}
              aria-activedescendant={
                directoriesOpen ? `wsl-directory-option-${activeDirectory}` : undefined
              }
              disabled={fieldsDisabled || discovery !== 'ready' || !distribution}
              onChange={(event) => {
                acceptedPath.current = null
                directoriesDismissed.current = false
                setPath(event.target.value)
                setPathError(null)
                setError(null)
              }}
              onFocus={() => {
                directoryFocused.current = true
                directoriesDismissed.current = false
                if (directoryState === 'ready' && directories.length > 0) setDirectoriesOpen(true)
              }}
              onBlur={() => {
                directoryFocused.current = false
                setDirectoriesOpen(false)
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  if (directories.length === 0) return
                  event.preventDefault()
                  directoriesDismissed.current = false
                  setDirectoriesOpen(true)
                  setActiveDirectory((previous) =>
                    !directoriesOpen
                      ? event.key === 'ArrowDown'
                        ? 0
                        : directories.length - 1
                      : (previous + (event.key === 'ArrowDown' ? 1 : -1) + directories.length) %
                        directories.length,
                  )
                } else if (
                  directoriesOpen &&
                  (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))
                ) {
                  event.preventDefault()
                  acceptDirectory(directories[activeDirectory])
                } else if (directoriesOpen && event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  directoriesDismissed.current = true
                  setDirectoriesOpen(false)
                }
              }}
              aria-invalid={pathError !== null}
              aria-describedby={pathError ? 'wsl-path-help wsl-path-error' : 'wsl-path-help'}
              className={controlClass}
            />
            {directoriesOpen ? (
              <div
                id="wsl-directories"
                role="listbox"
                tabIndex={-1}
                aria-label="Linux directories"
                className="mt-1 max-h-40 overflow-y-auto rounded-md border border-edge bg-app text-sm"
              >
                {directories.map((directory, index) => (
                  <button
                    type="button"
                    tabIndex={-1}
                    key={directory}
                    id={`wsl-directory-option-${index}`}
                    role="option"
                    aria-selected={index === activeDirectory}
                    className={`w-full cursor-pointer break-all px-3 py-2 text-left ${index === activeDirectory ? 'bg-highlight text-ink' : 'text-ink-secondary hover:bg-highlight'}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setActiveDirectory(index)
                      acceptDirectory(directory)
                    }}
                  >
                    {directory}
                  </button>
                ))}
              </div>
            ) : null}
            {directoryState === 'loading' ? (
              <p role="status" className="mt-2 text-xs text-ink-secondary">
                Loading directories...
              </p>
            ) : null}
            {directoryState === 'ready' && directories.length === 0 ? (
              <p role="status" className="mt-2 text-xs text-ink-secondary">
                No matching directories.
              </p>
            ) : null}
            {directoryError ? (
              <p role="alert" className="mt-2 text-sm text-ink">
                {directoryError}
              </p>
            ) : null}
            <p id="wsl-path-help" className="mt-2 text-xs text-ink-secondary">
              Use an absolute Linux path in this distribution.
            </p>
            {pathError ? (
              <p id="wsl-path-error" role="alert" className="mt-2 text-sm text-ink">
                {pathError}
              </p>
            ) : null}
          </>
        ) : ssh ? (
          <>
            <label className="mt-4 block text-sm" htmlFor="ssh-host">
              Host
            </label>
            <input
              ref={sshHostInput}
              id="ssh-host"
              placeholder="[2001:db8::1]"
              value={sshHost}
              autoComplete="off"
              disabled={fieldsDisabled}
              aria-invalid={sshFieldErrors.host !== undefined}
              aria-describedby={sshFieldErrors.host ? 'ssh-host-error' : 'ssh-help'}
              onChange={(event) => {
                setSshHost(event.target.value)
                setSshFieldErrors((previous) => ({ ...previous, host: undefined }))
                setError(null)
              }}
              className={controlClass}
            />
            {sshFieldErrors.host ? (
              <p id="ssh-host-error" role="alert" className="mt-2 text-sm text-ink">
                {sshFieldErrors.host}
              </p>
            ) : null}
            <label className="mt-4 block text-sm" htmlFor="ssh-user">
              User
            </label>
            <input
              ref={sshUserInput}
              id="ssh-user"
              placeholder="Optional"
              value={sshUser}
              autoComplete="off"
              disabled={fieldsDisabled}
              aria-invalid={sshFieldErrors.user !== undefined}
              aria-describedby={sshFieldErrors.user ? 'ssh-user-error' : 'ssh-help'}
              onChange={(event) => {
                setSshUser(event.target.value)
                setSshFieldErrors((previous) => ({ ...previous, user: undefined }))
                setError(null)
              }}
              className={controlClass}
            />
            {sshFieldErrors.user ? (
              <p id="ssh-user-error" role="alert" className="mt-2 text-sm text-ink">
                {sshFieldErrors.user}
              </p>
            ) : null}
            <label className="mt-4 block text-sm" htmlFor="ssh-port">
              Port
            </label>
            <input
              ref={sshPortInput}
              id="ssh-port"
              placeholder="22"
              inputMode="numeric"
              value={sshPort}
              autoComplete="off"
              disabled={fieldsDisabled}
              aria-invalid={sshFieldErrors.port !== undefined}
              aria-describedby={sshFieldErrors.port ? 'ssh-port-error' : 'ssh-help'}
              onChange={(event) => {
                setSshPort(event.target.value)
                setSshFieldErrors((previous) => ({ ...previous, port: undefined }))
                setError(null)
              }}
              className={controlClass}
            />
            {sshFieldErrors.port ? (
              <p id="ssh-port-error" role="alert" className="mt-2 text-sm text-ink">
                {sshFieldErrors.port}
              </p>
            ) : null}
            <label className="mt-4 block text-sm" htmlFor="ssh-directory">
              Remote directory
            </label>
            <input
              ref={sshPathInput}
              id="ssh-directory"
              placeholder="/home/user/project"
              value={sshRemotePath}
              autoComplete="off"
              disabled={fieldsDisabled}
              aria-invalid={sshFieldErrors.path !== undefined}
              aria-describedby={sshFieldErrors.path ? 'ssh-path-error ssh-help' : 'ssh-help'}
              onChange={(event) => {
                setSshRemotePath(event.target.value)
                setSshFieldErrors((previous) => ({ ...previous, path: undefined }))
                setError(null)
              }}
              className={controlClass}
            />
            {sshFieldErrors.path ? (
              <p id="ssh-path-error" role="alert" className="mt-2 text-sm text-ink">
                {sshFieldErrors.path}
              </p>
            ) : null}
            <p id="ssh-help" className="mt-2 text-xs text-ink-secondary">
              Use an absolute POSIX path on that host. The host must be trusted once outside NeKode
              (run ssh in a terminal for it) before it can be added.
            </p>
          </>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-ink-secondary">
            Choose a project folder on this computer. The folder will be added as a project.
          </p>
        )}
        {error ? (
          <div className="mt-3 rounded-md border border-error p-3">
            <p role="alert" className="text-sm text-ink">
              {error}
            </p>
            {registeredProject ? (
              <p className="mt-1 text-xs text-ink-secondary">
                The project was added. Retry opening it without adding it again.
              </p>
            ) : null}
          </div>
        ) : null}
        {busy ? (
          <p role="status" className="mt-3 text-sm text-ink-secondary">
            {primaryLabel} Wait for this step to finish.
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="h-control rounded-md px-4 text-sm text-ink-secondary hover:bg-highlight hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            ref={primaryAction}
            type="submit"
            disabled={
              busy || (!registeredProject && wsl && (discovery !== 'ready' || !distribution))
            }
            className="h-control rounded-md bg-accent px-4 text-sm font-semibold text-app hover:opacity-90 disabled:opacity-50"
          >
            {primaryLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}
