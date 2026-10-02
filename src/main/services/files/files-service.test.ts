import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../shared/ipc-error'
import {
  EXCLUDED_DIRECTORY_NAMES,
  type FilesFsAdapter,
  type FilesProjectLookup,
  FilesService,
  mapExtensionToLanguage,
  PREVIEW_MAX_BYTES,
} from './files-service'

// FilesService unit tests (spec Required tests): listing order and laziness,
// exclusion filtering, dotfiles, containment rejection (`..`, absolute paths,
// symlinks leaving the root), text/binary/too-large classification boundaries
// (2 MB exact vs over, NUL-byte and invalid-UTF-8 detection), extension→
// language mapping and unreadable/missing paths. The filesystem is a fake
// in-memory adapter so symlink and size boundaries are deterministic on any
// host (real symlinks need privileges on Windows).

type FakeNode =
  | { type: 'dir' }
  | { type: 'file'; content: Uint8Array }
  | { type: 'symlink'; target: string }

interface FakeFsOptions {
  nodes: Record<string, FakeNode>
  /** realpath identity by default; override to model linked directories. */
  realpathMap?: Record<string, string>
  readErrorPaths?: string[]
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function createFakeFs(options: FakeFsOptions): FilesFsAdapter & {
  readdirCalls: string[]
  readCalls: string[]
} {
  const nodes = new Map<string, FakeNode>()
  for (const [path, node] of Object.entries(options.nodes)) {
    nodes.set(path, node)
  }
  const realpathMap = new Map<string, string>(Object.entries(options.realpathMap ?? {}))
  const readErrorPaths = new Set(options.readErrorPaths ?? [])
  const readdirCalls: string[] = []
  const readCalls: string[] = []

  function resolveChain(path: string, seen: Set<string> = new Set()): string {
    // Follow symlink chains to the canonical node path (absolute targets only
    // in these fixtures), resolving intermediate components too — like the
    // real realpath(3) — and guarding against cycles.
    if (seen.has(path)) {
      return path
    }
    seen.add(path)
    const node = nodes.get(path)
    if (node !== undefined && node.type === 'symlink') {
      return resolveChain(node.target, seen)
    }
    const separator = path.lastIndexOf('/')
    if (separator === -1) {
      return path
    }
    const parent = path.slice(0, separator)
    if (parent.length === 0) {
      return path
    }
    return `${resolveChain(parent, seen)}/${path.slice(separator + 1)}`
  }

  return {
    readdirCalls,
    readCalls,
    async readdir(dirPath) {
      readdirCalls.push(dirPath)
      const node = nodes.get(dirPath)
      if (node === undefined || node.type !== 'dir') {
        throw new Error(`ENOENT: ${dirPath}`)
      }
      const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`
      const entries: Array<{ name: string; kind: 'file' | 'directory' | 'symlink' }> = []
      for (const [path, child] of nodes) {
        if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) {
          continue
        }
        entries.push({
          name: path.slice(prefix.length),
          kind: child.type === 'dir' ? 'directory' : child.type === 'file' ? 'file' : 'symlink',
        })
      }
      return entries
    },
    async stat(path) {
      const resolved = resolveChain(path)
      const node = nodes.get(resolved)
      if (node === undefined) {
        return null
      }
      if (node.type === 'dir') {
        return { size: 0, isFile: false, isDirectory: true }
      }
      if (node.type === 'file') {
        return { size: node.content.byteLength, isFile: true, isDirectory: false }
      }
      return null
    },
    async realpath(path) {
      const mapped = realpathMap.get(path) ?? path
      const resolved = resolveChain(mapped)
      return nodes.has(resolved) ? resolved : null
    },
    async readFile(path) {
      readCalls.push(path)
      if (readErrorPaths.has(path)) {
        throw new Error(`EACCES: ${path}`)
      }
      const resolved = resolveChain(path)
      const node = nodes.get(resolved)
      if (node === undefined || node.type !== 'file') {
        throw new Error(`ENOENT: ${path}`)
      }
      return node.content
    },
  }
}

const ROOT = 'D:/proj'
const projects: FilesProjectLookup = {
  get: (projectId) => (projectId === 'p1' ? { path: ROOT } : null),
}

function createService(
  fs: FilesFsAdapter,
  openExternal?: (path: string) => Promise<string>,
  projectLookup: FilesProjectLookup = projects,
) {
  return new FilesService({
    projects: projectLookup,
    fs,
    openExternal: openExternal ?? (async () => ''),
  })
}

async function captureError(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    return error as AppError
  }
  throw new Error('expected the call to reject')
}

describe('files:list — ordering, exclusions and laziness', () => {
  it('lists directories first, then files, case-insensitive alphabetical', async () => {
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/zeta`]: { type: 'dir' },
        [`${ROOT}/Alpha`]: { type: 'dir' },
        [`${ROOT}/beta`]: { type: 'dir' },
        [`${ROOT}/zoo.txt`]: { type: 'file', content: encode('z') },
        [`${ROOT}/Apple.ts`]: { type: 'file', content: encode('a') },
        [`${ROOT}/banana.ts`]: { type: 'file', content: encode('b') },
      },
    })
    const entries = await createService(fs).list('p1', null)
    expect(entries.map((entry) => entry.name)).toEqual([
      'Alpha',
      'beta',
      'zeta',
      'Apple.ts',
      'banana.ts',
      'zoo.txt',
    ])
    expect(entries.every((entry) => entry.relativePath === entry.name)).toBe(true)
  })

  it('filters the default directory exclusions at any depth but keeps same-named files', async () => {
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/.git`]: { type: 'dir' },
        [`${ROOT}/node_modules`]: { type: 'dir' },
        [`${ROOT}/vendor`]: { type: 'dir' },
        [`${ROOT}/.idea`]: { type: 'dir' },
        [`${ROOT}/.vscode`]: { type: 'dir' },
        [`${ROOT}/dist`]: { type: 'dir' },
        [`${ROOT}/build`]: { type: 'dir' },
        [`${ROOT}/coverage`]: { type: 'dir' },
        [`${ROOT}/dist.txt`]: { type: 'file', content: encode('d') },
        [`${ROOT}/src`]: { type: 'dir' },
        [`${ROOT}/src/node_modules`]: { type: 'dir' },
        [`${ROOT}/src/keep`]: { type: 'dir' },
        // Case-variant spellings filter the same way (Windows is
        // case-insensitive, review R2-1).
        [`${ROOT}/NODE_MODULES`]: { type: 'dir' },
      },
    })
    const service = createService(fs)
    const rootEntries = await service.list('p1', null)
    expect(rootEntries.map((entry) => entry.name)).toEqual(['src', 'dist.txt'])
    // Nested exclusions are filtered the same way (directory names at any depth).
    const srcEntries = await service.list('p1', 'src')
    expect(srcEntries.map((entry) => entry.name)).toEqual(['keep'])
    expect([...EXCLUDED_DIRECTORY_NAMES].sort()).toEqual(
      ['.git', '.idea', '.vscode', 'build', 'coverage', 'dist', 'node_modules', 'vendor'].sort(),
    )
  })

  it('shows dotfiles (only the exclusion list filters)', async () => {
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/.env`]: { type: 'file', content: encode('SECRET=1') },
        [`${ROOT}/.gitignore`]: { type: 'file', content: encode('out') },
        [`${ROOT}/.github`]: { type: 'dir' },
      },
    })
    const entries = await createService(fs).list('p1', null)
    expect(entries.map((entry) => entry.name)).toEqual(['.github', '.env', '.gitignore'])
  })

  it('reads exactly one directory level per call (lazy, one readdir each)', async () => {
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/src`]: { type: 'dir' },
        [`${ROOT}/src/deep`]: { type: 'dir' },
        [`${ROOT}/src/deep/file.ts`]: { type: 'file', content: encode('x') },
        [`${ROOT}/README.md`]: { type: 'file', content: encode('# hi') },
      },
    })
    const service = createService(fs)
    await service.list('p1', null)
    expect(fs.readdirCalls).toEqual([ROOT])
    await service.list('p1', 'src')
    expect(fs.readdirCalls).toEqual([ROOT, `${ROOT}/src`])
    // Nothing outside the requested level is touched.
    expect(fs.readCalls).toEqual([])
  })

  it('lists an empty directory as no entries and resolves nested relative paths', async () => {
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/empty`]: { type: 'dir' },
        [`${ROOT}/app`]: { type: 'dir' },
        [`${ROOT}/app/Services`]: { type: 'dir' },
        [`${ROOT}/app/Services/Billing.php`]: { type: 'file', content: encode('<?php') },
      },
    })
    const service = createService(fs)
    expect(await service.list('p1', 'empty')).toEqual([])
    const nested = await service.list('p1', 'app/Services')
    expect(nested).toEqual([
      { name: 'Billing.php', relativePath: 'app/Services/Billing.php', kind: 'file' },
    ])
  })

  it('passes Unicode and space names through unchanged', async () => {
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/Zażółć gęślą`]: { type: 'dir' },
        [`${ROOT}/my notes 2026.md`]: { type: 'file', content: encode('notatki') },
      },
    })
    const entries = await createService(fs).list('p1', null)
    expect(entries.map((entry) => entry.name)).toEqual(['Zażółć gęślą', 'my notes 2026.md'])
    expect(entries[1].relativePath).toBe('my notes 2026.md')
  })
})

describe('files — path containment', () => {
  const outsideNodes = {
    [ROOT]: { type: 'dir' },
    [`${ROOT}/file.txt`]: { type: 'file', content: encode('inside') },
    [`${ROOT}/link-out`]: { type: 'symlink', target: 'D:/outside/secret.txt' },
    [`${ROOT}/dir-link-out`]: { type: 'symlink', target: 'D:/outside' },
    'D:/outside': { type: 'dir' },
    'D:/outside/secret.txt': { type: 'file', content: encode('top secret') },
    'D:/outside/leak.txt': { type: 'file', content: encode('leak') },
  } satisfies Record<string, FakeNode>

  it('rejects ".." traversal with the same error as a missing path', async () => {
    const fs = createFakeFs({ nodes: { ...outsideNodes } })
    const service = createService(fs)
    const traversal = await captureError(() => service.list('p1', '../outside'))
    const missing = await captureError(() => service.list('p1', 'no-such-dir'))
    expect(traversal.code).toBe('not_found')
    expect(traversal.message).toBe(missing.message)

    const readTraversal = await captureError(() => service.read('p1', '../outside/leak.txt'))
    expect(readTraversal.code).toBe('not_found')
    expect(readTraversal.message).toBe(missing.message)
  })

  it('rejects absolute paths with the not-found error and returns no content', async () => {
    const fs = createFakeFs({ nodes: { ...outsideNodes } })
    const service = createService(fs)
    const error = await captureError(() => service.read('p1', 'D:/outside/secret.txt'))
    expect(error.code).toBe('not_found')
    const listError = await captureError(() => service.list('p1', 'D:/outside'))
    expect(listError.code).toBe('not_found')
  })

  it('rejects symlinks leaving the root for both listing and reading', async () => {
    const fs = createFakeFs({ nodes: { ...outsideNodes } })
    const service = createService(fs)
    const readError = await captureError(() => service.read('p1', 'link-out'))
    expect(readError.code).toBe('not_found')
    const listError = await captureError(() => service.list('p1', 'dir-link-out'))
    expect(listError.code).toBe('not_found')
    // A listing of the root still works and never leaks the outside target.
    const entries = await service.list('p1', null)
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      'dir-link-out',
      'file.txt',
      'link-out',
    ])
    // The symlink entry resolves to its target kind (outside content is only
    // reachable through the containment check above).
    expect(entries.find((entry) => entry.name === 'dir-link-out')?.kind).toBe('directory')
    expect(entries.find((entry) => entry.name === 'link-out')?.kind).toBe('file')
  })

  it('allows symlinks staying inside the root', async () => {
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/real`]: { type: 'dir' },
        [`${ROOT}/real/inner.txt`]: { type: 'file', content: encode('inner') },
        [`${ROOT}/alias`]: { type: 'symlink', target: `${ROOT}/real` },
      },
    })
    const service = createService(fs)
    const entries = await service.list('p1', 'alias')
    expect(entries).toEqual([{ name: 'inner.txt', relativePath: 'alias/inner.txt', kind: 'file' }])
    const preview = await service.read('p1', 'alias/inner.txt')
    expect(preview).toEqual({ kind: 'text', content: 'inner', language: null })
  })
})

describe('files:read — classification', () => {
  function fsWithFile(content: Uint8Array) {
    return createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/data.bin`]: { type: 'file', content },
      },
    })
  }

  it('previews a text file exactly at the 2 MB threshold', async () => {
    const content = new Uint8Array(PREVIEW_MAX_BYTES).fill(0x41) // 'A' * 2 MB
    const preview = await createService(fsWithFile(content)).read('p1', 'data.bin')
    expect(preview.kind).toBe('text')
    if (preview.kind === 'text') {
      expect(preview.content.length).toBe(PREVIEW_MAX_BYTES)
      expect(preview.language).toBeNull()
    }
  })

  it('falls back to too-large one byte over the threshold, with the size', async () => {
    const content = new Uint8Array(PREVIEW_MAX_BYTES + 1).fill(0x41)
    const fs = fsWithFile(content)
    const preview = await createService(fs).read('p1', 'data.bin')
    expect(preview).toEqual({ kind: 'too-large', size: PREVIEW_MAX_BYTES + 1 })
    // Too-large never reads the content.
    expect(fs.readCalls).toEqual([])
  })

  it('classifies a NUL byte in the first 8 KB as binary', async () => {
    const content = new Uint8Array(32)
    content[10] = 0x00
    content.fill(0x41, 0, 10)
    content.fill(0x41, 11)
    const preview = await createService(fsWithFile(content)).read('p1', 'data.bin')
    expect(preview).toEqual({ kind: 'binary' })
  })

  it('keeps a NUL byte past the 8 KB sniff window as text (spec Behaviour 10)', async () => {
    const content = new Uint8Array(9000).fill(0x41)
    content[8500] = 0x00
    const preview = await createService(fsWithFile(content)).read('p1', 'data.bin')
    expect(preview.kind).toBe('text')
  })

  it('classifies invalid UTF-8 as binary (fatal decode)', async () => {
    const content = Uint8Array.from([0x41, 0x42, 0xff, 0xfe, 0x43])
    const preview = await createService(fsWithFile(content)).read('p1', 'data.bin')
    expect(preview).toEqual({ kind: 'binary' })
  })

  it('previews an empty file as an empty text document', async () => {
    const preview = await createService(fsWithFile(new Uint8Array(0))).read('p1', 'data.bin')
    expect(preview).toEqual({ kind: 'text', content: '', language: null })
  })

  it('returns the not-found error for a missing file or a directory', async () => {
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/dir`]: { type: 'dir' },
      },
    })
    const service = createService(fs)
    const missing = await captureError(() => service.read('p1', 'gone.txt'))
    expect(missing.code).toBe('not_found')
    const asFile = await captureError(() => service.read('p1', 'dir'))
    expect(asFile.code).toBe('not_found')
  })

  it('maps unknown projects to the not-found error', async () => {
    const fs = createFakeFs({ nodes: { [ROOT]: { type: 'dir' } } })
    const error = await captureError(() => createService(fs).list('p-missing', null))
    expect(error.code).toBe('not_found')
    expect(error.message).not.toContain(ROOT)
  })
})

describe('files — extension → language mapping', () => {
  it('maps known extensions to monaco language ids', () => {
    expect(mapExtensionToLanguage('App.tsx')).toBe('typescript')
    expect(mapExtensionToLanguage('main.ts')).toBe('typescript')
    expect(mapExtensionToLanguage('legacy.js')).toBe('javascript')
    expect(mapExtensionToLanguage('notes.md')).toBe('markdown')
    expect(mapExtensionToLanguage('script.py')).toBe('python')
    expect(mapExtensionToLanguage('lib.rs')).toBe('rust')
    expect(mapExtensionToLanguage('style.css')).toBe('css')
    expect(mapExtensionToLanguage('index.html')).toBe('html')
    expect(mapExtensionToLanguage('schema.sql')).toBe('sql')
  })

  it('is case-insensitive on the extension and handles special names', () => {
    expect(mapExtensionToLanguage('App.TS')).toBe('typescript')
    expect(mapExtensionToLanguage('Dockerfile')).toBe('dockerfile')
  })

  it('falls back to plain text (null) for unknown or missing extensions', () => {
    expect(mapExtensionToLanguage('archive.xyz')).toBeNull()
    expect(mapExtensionToLanguage('Makefile')).toBeNull()
    expect(mapExtensionToLanguage('.env')).toBeNull()
    expect(mapExtensionToLanguage('file.')).toBeNull()
  })

  it('carries the mapped language on the text preview', async () => {
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/app.ts`]: { type: 'file', content: encode('const x = 1') },
      },
    })
    const preview = await createService(fs).read('p1', 'app.ts')
    expect(preview).toEqual({ kind: 'text', content: 'const x = 1', language: 'typescript' })
  })
})

describe('files:openExternal', () => {
  it('opens a contained path via the injected OS opener', async () => {
    const openExternal = vi.fn(async () => '')
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/doc.pdf`]: { type: 'file', content: encode('pdf') },
      },
    })
    await createService(fs, openExternal).openExternal('p1', 'doc.pdf')
    expect(openExternal).toHaveBeenCalledWith(`${ROOT}/doc.pdf`)
  })

  it('reports a failed OS open as a typed error', async () => {
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/doc.pdf`]: { type: 'file', content: encode('pdf') },
      },
    })
    const error = await captureError(() =>
      createService(fs, async () => 'no application association').openExternal('p1', 'doc.pdf'),
    )
    expect(error.code).toBe('unknown')
  })

  it('never opens a path outside the root', async () => {
    const openExternal = vi.fn(async () => '')
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/link-out`]: { type: 'symlink', target: 'D:/outside/secret.txt' },
        'D:/outside/secret.txt': { type: 'file', content: encode('secret') },
      },
    })
    const error = await captureError(() =>
      createService(fs, openExternal).openExternal('p1', 'link-out'),
    )
    expect(error.code).toBe('not_found')
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('files:openRoot', () => {
  it('opens the registered project root via the injected OS opener', async () => {
    const openExternal = vi.fn(async () => '')
    const fs = createFakeFs({ nodes: { [ROOT]: { type: 'dir' } } })
    await createService(fs, openExternal).openRoot('p1')
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith(ROOT)
  })

  it('reports a missing project as not_found without touching the OS', async () => {
    const openExternal = vi.fn(async () => '')
    const fs = createFakeFs({ nodes: { [ROOT]: { type: 'dir' } } })
    const error = await captureError(() => createService(fs, openExternal).openRoot('missing'))
    expect(error.code).toBe('not_found')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('reports a vanished root directory as not_found without touching the OS', async () => {
    const openExternal = vi.fn(async () => '')
    const fs = createFakeFs({ nodes: {} })
    const error = await captureError(() => createService(fs, openExternal).openRoot('p1'))
    expect(error.code).toBe('not_found')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('reports a failed OS open as a typed error', async () => {
    const fs = createFakeFs({ nodes: { [ROOT]: { type: 'dir' } } })
    const error = await captureError(() =>
      createService(fs, async () => 'no association').openRoot('p1'),
    )
    expect(error.code).toBe('unknown')
  })
})

describe('files — project root failures', () => {
  it('reports a missing/unreadable project root as the typed error (inline tree error)', async () => {
    const fs = createFakeFs({ nodes: {} })
    const service = createService(fs)
    const listError = await captureError(() => service.list('p1', null))
    expect(listError.code).toBe('not_found')
    const readError = await captureError(() => service.read('p1', 'x.txt'))
    expect(readError.code).toBe('not_found')
  })

  it('reports listing a non-directory and unreadable reads as the typed error', async () => {
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/notes.txt`]: { type: 'file', content: encode('x') },
        [`${ROOT}/unreadable.txt`]: { type: 'file', content: encode('y') },
      },
      readErrorPaths: [`${ROOT}/unreadable.txt`],
    })
    const service = createService(fs)
    const notADirectory = await captureError(() => service.list('p1', 'notes.txt'))
    expect(notADirectory.code).toBe('not_found')
    const unreadable = await captureError(() => service.read('p1', 'unreadable.txt'))
    expect(unreadable.code).toBe('not_found')
  })
})

describe('files — drive-root projects and exclusion enforcement', () => {
  it('serves children of a project rooted at a drive root (realpath trailing separator)', async () => {
    // realpath returns 'D:/' (trailing separator) for a drive root; the
    // containment prefix must still admit its children (review F1).
    const driveRoot = 'D:/'
    const driveProjects: FilesProjectLookup = {
      get: (projectId) => (projectId === 'p2' ? { path: driveRoot } : null),
    }
    const fs = createFakeFs({
      nodes: {
        [driveRoot]: { type: 'dir' },
        [`${driveRoot}src`]: { type: 'dir' },
        [`${driveRoot}src/a.ts`]: { type: 'file', content: encode('const a = 1') },
      },
    })
    const service = createService(fs, undefined, driveProjects)
    const entries = await service.list('p2', 'src')
    expect(entries.map((entry) => entry.relativePath)).toEqual(['src/a.ts'])
    const preview = await service.read('p2', 'src/a.ts')
    expect(preview.kind).toBe('text')
    if (preview.kind === 'text') {
      expect(preview.content).toBe('const a = 1')
      expect(preview.language).toBe(mapExtensionToLanguage('a.ts'))
    }
  })

  it('never descends into excluded directories via direct requests', async () => {
    // Listings filter exclusion names (Behaviour 5); crafted requests must
    // not bypass the filter (review F2).
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/node_modules`]: { type: 'dir' },
        [`${ROOT}/node_modules/pkg.js`]: { type: 'file', content: encode('p') },
        // Case-variant node spellings model the case-insensitive Windows
        // filesystem so the case-folded guard is what rejects them.
        [`${ROOT}/NODE_MODULES`]: { type: 'dir' },
        [`${ROOT}/NODE_MODULES/pkg.js`]: { type: 'file', content: encode('p') },
        [`${ROOT}/Node_Modules`]: { type: 'dir' },
        [`${ROOT}/Node_Modules/pkg.js`]: { type: 'file', content: encode('p') },
        [`${ROOT}/dist`]: { type: 'dir' },
        [`${ROOT}/dist/config.json`]: { type: 'file', content: encode('{}') },
        [`${ROOT}/build`]: { type: 'dir' },
        [`${ROOT}/coverage`]: { type: 'file', content: encode('c') },
      },
    })
    const service = createService(fs)
    expect((await captureError(() => service.list('p1', 'node_modules'))).code).toBe('not_found')
    expect((await captureError(() => service.read('p1', 'node_modules/pkg.js'))).code).toBe(
      'not_found',
    )
    // Windows filesystems are case-insensitive: case-variant spellings must
    // not reach the excluded directory either (review R2-1).
    expect((await captureError(() => service.list('p1', 'NODE_MODULES'))).code).toBe('not_found')
    expect((await captureError(() => service.read('p1', 'Node_Modules/pkg.js'))).code).toBe(
      'not_found',
    )
    expect((await captureError(() => service.read('p1', 'dist/config.json'))).code).toBe(
      'not_found',
    )
    expect((await captureError(() => service.openExternal('p1', 'build'))).code).toBe('not_found')
    // The exclusion list filters directory names only — a same-named file
    // still previews (Behaviour 5).
    const file = await service.read('p1', 'coverage')
    expect(file.kind).toBe('text')
  })

  it('returns canonical relative paths even for crafted inputs that resolve inside the root', async () => {
    // The echoed relativePath must come from the canonical target (review
    // F3), so a follow-up read on it always resolves.
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/src`]: { type: 'dir' },
        [`${ROOT}/src/keep.ts`]: { type: 'file', content: encode('k') },
      },
    })
    const service = createService(fs)
    const entries = await service.list('p1', '../proj/src')
    expect(entries.map((entry) => entry.relativePath)).toEqual(['src/keep.ts'])
  })

  it('rejects NTFS alternate data stream forms as not-found', async () => {
    // ':' addresses a stream inside a file (file.txt:stream) — invisible to
    // the tree, so it resolves like every rejected shape (review F4). The
    // fixture models the stream node so the guard is what rejects it.
    const fs = createFakeFs({
      nodes: {
        [ROOT]: { type: 'dir' },
        [`${ROOT}/file.txt`]: { type: 'file', content: encode('f') },
        [`${ROOT}/file.txt:stream`]: { type: 'file', content: encode('stream') },
      },
    })
    const service = createService(fs)
    const error = await captureError(() => service.read('p1', 'file.txt:stream'))
    expect(error.code).toBe('not_found')
  })
})
