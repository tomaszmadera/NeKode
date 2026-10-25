export interface DetachedChild {
  unref: () => void
  once: (event: 'error' | 'spawn', listener: (error?: Error) => void) => void
}

export interface DetachedSpawnOptions {
  detached: true
  stdio: 'ignore'
  windowsHide: false
}

export function startDetached(
  spawnFn: (file: string, args: readonly string[], options: DetachedSpawnOptions) => DetachedChild,
  file: string,
  args: readonly string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnFn(file, args, { detached: true, stdio: 'ignore', windowsHide: false })
    child.once('error', (error) => {
      reject(error ?? new Error('Could not start the installer.'))
    })
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
