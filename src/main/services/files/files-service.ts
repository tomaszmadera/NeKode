import { promises as nodeFs } from 'node:fs'
import { posix } from 'node:path'
import type { FileEntry, FilePreview } from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'

// Project file listing and read-only preview classification (spec Data/API,
// Business rules). The renderer never touches the filesystem: every listing
// and read goes through this service behind the typed IPC channels. All
// access is read-only; the only OS-facing action is openExternal
// (shell.openPath in main, injected here).
//
// Path containment: every request resolves against the registered project
// root (projectId → ProjectService), and anything resolving outside that
// root — `..` escapes, absolute inputs, symlinks leaving the root — is
// rejected with the exact same error as a missing path (spec Errors: the two
// cases are indistinguishable to the caller and never leak outside paths).

/** Preview threshold (spec Behaviour 10): exactly 2 MB previews, over does not. */
export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024

/** Binary sniff window (spec Behaviour 10): NUL in the first 8 KB. */
export const BINARY_SNIFF_BYTES = 8 * 1024

/** Default directory exclusions (SDD §12): directory names at any depth. */
export const EXCLUDED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'vendor',
  '.idea',
  '.vscode',
  'dist',
  'build',
  'coverage',
])

// Extension → monaco language id (spec Behaviour 7: syntax highlighting
// derived from the extension where supported; the renderer falls back to
// plain text for null). Ids must match the languages registered by the
// bundled monaco basic-languages set.
const EXTENSION_LANGUAGE: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  py: 'python',
  pyw: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  sql: 'sql',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  ini: 'ini',
  ps1: 'powershell',
  psm1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  graphql: 'graphql',
  gql: 'graphql',
  lua: 'lua',
  pl: 'perl',
  pm: 'perl',
  r: 'r',
  swift: 'swift',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  fs: 'fsharp',
  fsx: 'fsharp',
  scala: 'scala',
  clj: 'clojure',
  cljs: 'clojure',
  proto: 'protobuf',
  sol: 'solidity',
  twig: 'twig',
  vb: 'vb',
  m: 'objective-c',
  mm: 'objective-c',
}

/** Language for a file name (extension mapping, case-insensitive). */
export function mapExtensionToLanguage(name: string): string | null {
  const lower = name.toLowerCase()
  if (lower === 'dockerfile') {
    return 'dockerfile'
  }
  const extension = posix.extname(lower).slice(1)
  return EXTENSION_LANGUAGE[extension] ?? null
}

/** Minimal project lookup (the ProjectService surface this service needs). */
export interface FilesProjectLookup {
  get(projectId: string): { path: string } | null
}

export interface FilesFsEntry {
  name: string
  kind: 'file' | 'directory' | 'symlink'
}

/**
 * Filesystem surface used by the service (node:fs/promises by default).
 * Injectable so tests run deterministic size/binary/symlink fixtures.
 */
export interface FilesFsAdapter {
  /** One directory read; throws when the path is missing or not a directory. */
  readdir(dirPath: string): Promise<FilesFsEntry[]>
  /** Follows symlinks; null when the path does not resolve. */
  stat(path: string): Promise<{ size: number; isFile: boolean; isDirectory: boolean } | null>
  /** Canonical path (symlinks resolved); null when the path does not resolve. */
  realpath(path: string): Promise<string | null>
  readFile(path: string): Promise<Uint8Array>
}

export interface FilesServiceDeps {
  projects: FilesProjectLookup
  fs?: FilesFsAdapter
  /**
   * OS default-application open (shell.openPath in main). Resolves '' on
   * success and an error description on failure (the Electron contract).
   */
  openExternal: (absolutePath: string) => Promise<string>
}

/** Containment failures are indistinguishable from missing paths (spec Errors). */
function notFound(channel: string): AppError {
  return new AppError('not_found', 'File not found.', channel)
}

function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

/** Absolute inputs are rejected up front: requests are project-relative only. */
function isAbsolutePosix(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:\//.test(path)
}

function compareEntries(a: FileEntry, b: FileEntry): number {
  const aDirectory = a.kind === 'directory' ? 0 : 1
  const bDirectory = b.kind === 'directory' ? 0 : 1
  if (aDirectory !== bDirectory) {
    return aDirectory - bDirectory
  }
  const aLower = a.name.toLowerCase()
  const bLower = b.name.toLowerCase()
  if (aLower !== bLower) {
    return aLower < bLower ? -1 : 1
  }
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

function hasNulByte(content: Uint8Array, window: number): boolean {
  const limit = Math.min(window, content.byteLength)
  for (let index = 0; index < limit; index += 1) {
    if (content[index] === 0) {
      return true
    }
  }
  return false
}

const nodeFsAdapter: FilesFsAdapter = {
  async readdir(dirPath) {
    const entries = await nodeFs.readdir(dirPath, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'symlink',
    }))
  },
  async stat(path) {
    try {
      const stats = await nodeFs.stat(path)
      return { size: stats.size, isFile: stats.isFile(), isDirectory: stats.isDirectory() }
    } catch {
      return null
    }
  },
  async realpath(path) {
    try {
      return await nodeFs.realpath(path)
    } catch {
      return null
    }
  },
  async readFile(path) {
    return await nodeFs.readFile(path)
  },
}

export class FilesService {
  readonly #projects: FilesProjectLookup
  readonly #fs: FilesFsAdapter
  readonly #openExternal: (absolutePath: string) => Promise<string>

  constructor(deps: FilesServiceDeps) {
    this.#projects = deps.projects
    this.#fs = deps.fs ?? nodeFsAdapter
    this.#openExternal = deps.openExternal
  }

  /** One directory level of the project tree (null = project root). */
  async list(projectId: string, relativePath: string | null): Promise<FileEntry[]> {
    const channel = 'files:list'
    const { target, requestRel } = await this.#locate(projectId, relativePath, channel)

    let listed: FilesFsEntry[]
    try {
      listed = await this.#fs.readdir(target)
    } catch {
      throw notFound(channel)
    }

    const entries: FileEntry[] = []
    for (const entry of listed) {
      let kind: 'file' | 'directory'
      if (entry.kind === 'symlink') {
        // Symlink entries are classified by their target; broken links are
        // skipped and links leaving the root stay name-only (opening them
        // fails with the containment error).
        const stats = await this.#fs.stat(posix.join(target, entry.name))
        if (stats === null) {
          continue
        }
        if (stats.isDirectory) {
          kind = 'directory'
        } else if (stats.isFile) {
          kind = 'file'
        } else {
          continue
        }
      } else {
        kind = entry.kind
      }
      if (kind === 'directory' && EXCLUDED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
        continue
      }
      entries.push({
        name: entry.name,
        relativePath: requestRel === '' ? entry.name : `${requestRel}/${entry.name}`,
        kind,
      })
    }
    entries.sort(compareEntries)
    return entries
  }

  /** Read-only preview classification of one project file. */
  async read(projectId: string, relativePath: string): Promise<FilePreview> {
    const channel = 'files:read'
    const { target } = await this.#locate(projectId, relativePath, channel)

    const stats = await this.#fs.stat(target)
    if (stats === null || !stats.isFile) {
      throw notFound(channel)
    }
    if (stats.size > PREVIEW_MAX_BYTES) {
      // Too-large is classified from the size alone — the content is never
      // read (spec Behaviour 10).
      return { kind: 'too-large', size: stats.size }
    }

    let content: Uint8Array
    try {
      content = await this.#fs.readFile(target)
    } catch {
      throw notFound(channel)
    }
    if (hasNulByte(content, BINARY_SNIFF_BYTES)) {
      return { kind: 'binary' }
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(content)
      return {
        kind: 'text',
        content: text,
        language: mapExtensionToLanguage(posix.basename(target)),
      }
    } catch {
      // Not decodable as UTF-8 (spec Behaviour 10).
      return { kind: 'binary' }
    }
  }

  /** Opens the file with the OS default application (spec Behaviour 11). */
  async openExternal(projectId: string, relativePath: string): Promise<void> {
    const channel = 'files:openExternal'
    const { target } = await this.#locate(projectId, relativePath, channel)
    const failure = await this.#openExternal(target)
    if (failure !== '') {
      throw new AppError('unknown', 'Failed to open the file externally.', channel)
    }
  }

  /**
   * Opens the registered project root directory in the OS file manager.
   * The root is a registered project id lookup, so no path traversal is
   * possible; a vanished root resolves as the not-found error like every
   * other rejected shape.
   */
  async openRoot(projectId: string): Promise<void> {
    const channel = 'files:openRoot'
    const project = this.#projects.get(projectId)
    if (project === null) {
      throw new AppError('not_found', 'Project not found.', channel)
    }
    const root = toPosix(project.path)
    const stats = await this.#fs.stat(root)
    if (stats === null || !stats.isDirectory) {
      throw notFound(channel)
    }
    const failure = await this.#openExternal(root)
    if (failure !== '') {
      throw new AppError('unknown', 'Failed to open the file externally.', channel)
    }
  }

  /**
   * Resolves a request path against the registered project root and enforces
   * containment on the canonical (symlink-resolved) path.
   */
  async #locate(
    projectId: string,
    relativePath: string | null,
    channel: string,
  ): Promise<{ root: string; target: string; requestRel: string }> {
    const project = this.#projects.get(projectId)
    if (project === null) {
      throw new AppError('not_found', 'Project not found.', channel)
    }
    const root = toPosix(project.path)
    if (relativePath === null) {
      return { root, target: root, requestRel: '' }
    }
    const input = toPosix(relativePath)
    if (isAbsolutePosix(input) || input.includes(':')) {
      // Absolute forms and NTFS alternate data streams (file.txt:stream —
      // content inside a file but invisible to the tree) resolve as
      // not-found, like every other rejected shape (spec Errors).
      throw notFound(channel)
    }
    const target = posix.join(root, input)

    const realRoot = await this.#fs.realpath(root)
    const realTarget = await this.#fs.realpath(target)
    if (realRoot === null || realTarget === null) {
      throw notFound(channel)
    }
    const rootPosix = toPosix(realRoot)
    const targetPosix = toPosix(realTarget)
    // Drive roots carry a trailing separator ('D:/') while child paths do
    // not — compare stripped forms ('D:', '' for '/') so children of a
    // root-level project resolve; a bare POSIX root strips to '' and the
    // resulting '/' prefix keeps every absolute path contained.
    const rootPrefix = rootPosix.replace(/\/+$/, '')
    const targetPrefix = targetPosix.replace(/\/+$/, '')
    if (targetPrefix !== rootPrefix && !targetPrefix.startsWith(`${rootPrefix}/`)) {
      // `..` escapes and symlinks leaving the root land here — the same
      // error as a missing path (spec Errors).
      throw notFound(channel)
    }
    // The request path lexically normalized against the registered root
    // (never the raw input: crafted `..` forms must not echo a relativePath
    // the follow-up read cannot resolve) and never the realpath (in-root
    // symlinked directories keep the name the user navigated).
    const requestRel = posix.relative(root, target)
    const segments = requestRel === '' ? [] : requestRel.split('/')
    // Excluded directories stay unreachable through direct requests too:
    // listings filter their names (spec Behaviour 5), and a crafted request
    // must not descend into them either. Names compare case-folded: the
    // target filesystem (Windows) is case-insensitive (review R2-1).
    for (const segment of segments.slice(0, -1)) {
      if (EXCLUDED_DIRECTORY_NAMES.has(segment.toLowerCase())) {
        throw notFound(channel)
      }
    }
    const leaf = segments[segments.length - 1]
    if (leaf !== undefined && EXCLUDED_DIRECTORY_NAMES.has(leaf.toLowerCase())) {
      // The exclusion list filters directory names only — a same-named file
      // is a normal previewable entry (spec Behaviour 5).
      const stats = await this.#fs.stat(target)
      if (stats?.isDirectory) {
        throw notFound(channel)
      }
    }
    return { root: rootPosix, target: targetPosix, requestRel }
  }
}
