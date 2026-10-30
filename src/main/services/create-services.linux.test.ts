import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isWindowsHost } from '../test-support/host-path'
import { createServices } from './create-services'
import { listWslDirectoriesAsync, listWslDistributionsAsync } from './terminal/wsl'

vi.mock('./terminal/node-pty-factory', () => ({
  createNodePty: vi.fn(() => ({
    pid: 1,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: () => ({ dispose: vi.fn() }),
    onExit: () => ({ dispose: vi.fn() }),
  })),
}))
// Inside a WSL distribution wsl.exe interop is on PATH and answers, so the
// gate must come from the host platform, not from wsl.exe availability.
vi.mock('./terminal/wsl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./terminal/wsl')>()),
  listWslDistributionsAsync: vi.fn(async () => ['Ubuntu-24.04']),
  listWslDirectoriesAsync: vi.fn(async () => ['/home/user/Project']),
}))

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const userDataPath = mkdtempSync(join(tmpdir(), 'nekode-linux-'))
  scratch.push(userDataPath)
  return createServices({
    dbPath: ':memory:',
    userDataPath,
    openExternal: async () => '',
    showInFolder: () => undefined,
    trashItem: async () => undefined,
    pickDirectory: async () => null,
  })
}

describe.skipIf(isWindowsHost)('WSL wiring on a Linux host', () => {
  it('hides WSL discovery and refuses WSL projects even when wsl.exe interop answers', () => {
    const services = setup()
    expect(services.projects.wslDistributions()).toEqual([])
    expect(() => services.projects.wslDirectories('Ubuntu-24.04', '/home/user')).toThrow(
      /only when NeKode runs on Windows/,
    )
    expect(() => services.projects.addWsl('Ubuntu-24.04', '/home/user/Project')).toThrow(
      /only when NeKode runs on Windows/,
    )
    expect(listWslDistributionsAsync).not.toHaveBeenCalled()
    expect(listWslDirectoriesAsync).not.toHaveBeenCalled()
  })
})
