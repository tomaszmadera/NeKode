import { promises as nodeFs } from 'node:fs'
import { posix, win32 } from 'node:path'
import type { FileEntry, FilePreview } from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { projectEnvironment } from '@shared/project-environment'
import type { SshTarget } from '@shared/ssh-target'
import { joinProjectPath } from '../project-path'

// Project file listing and read-only preview classification (spec Data/API,
// Business rules). The renderer never touches the filesystem: every listing
// and read goes through this service behind the typed IPC channels.
// Listing and preview stay read-only. Reveal and Recycle Bin use
// shell.showItemInFolder and shell.trashItem in main, injected here.
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

/** One remote directory level: canonical paths plus the entries of that level. */
export interface FilesRemoteListing {
  /** `pwd -P` of the registered project root on the remote host. */
  realRoot: string
  /** `pwd -P` of the requested directory. */
  realTarget: string
  entries: FilesFsEntry[]
}

/** One remote file read: canonical paths, full size and the capped content. */
export interface FilesRemoteFile {
  realRoot: string
  realTarget: string
  /** Full `wc -c` size, which may exceed the capped content. */
  size: number
  /** At most PREVIEW_MAX_BYTES + 1 bytes. */
  content: Uint8Array
}

/**
 * Optional per-request batch capability of a remote adapter (spec ssh-projects
 * Behaviour 10 and Data/API): one SSH invocation answers containment, stat and
 * payload together, so one listing is one remote call. A null result means the
 * path is missing, unreadable or not a regular file.
 */
export interface FilesRemoteAdapter {
  list(dir: string): Promise<FilesRemoteListing | null>
  read(path: string): Promise<FilesRemoteFile | null>
}

/**
 * Filesystem surface used by the service (node:fs/promises by default).
 * Injectable so tests run deterministic size/binary/symlink fixtures.
 */
export interface FilesFsAdapter {
  /** One directory read; throws when the path is missing or not a directory. */
  readdir(dirPath: string): Promise<FilesFsEntry[]>
  /** Follows symlinks; null when the path does not resolve. */
  stat(path: string): Promise<{
    size: number
    mtimeMs: number
    isFile: boolean
    isDirectory: boolean
  } | null>
  /** Canonical path (symlinks resolved); null when the path does not resolve. */
  realpath(path: string): Promise<string | null>
  readFile(path: string): Promise<Uint8Array>
}

export interface FilesServiceDeps {
  projects: FilesProjectLookup
  fs?: FilesFsAdapter
  /**
   * Remote adapter factory, selected from the stored project path for an SSH
   * project (spec ssh-projects Behaviour 10). Absent means the SSH transport is
   * not wired and remote projects report `unsupported`.
   */
  remote?: (target: SshTarget) => FilesRemoteAdapter
  /**
   * OS default-application open (shell.openPath in main). Resolves '' on
   * success and an error description on failure (the Electron contract).
   */
  openExternal: (absolutePath: string) => Promise<string>
  /** Reveals the lexical path in Explorer (shell.showItemInFolder). */
  showInFolder: (absolutePath: string) => void
  /** Moves the lexical path to the Windows Recycle Bin (shell.trashItem). */
  trashItem: (absolutePath: string) => Promise<void>
  /**
   * Host platform; injectable for tests. Only win32 converts paths for the
   * Windows shell COM APIs below; elsewhere the lexical POSIX path is passed
   * through unchanged (a backslash form is not a valid Linux path).
   */
  platform?: NodeJS.Platform
}

/**
 * Windows shell COM APIs (SHOpenFolderAndSelectItems in showInFolder,
 * IFileOperation in trashItem) require backslash paths, including UNC shares.
 * In contrast, shell.openPath (openExternal, openRoot) uses ShellExecuteExW
 * which accepts forward-slash paths and forward-slash WSL UNC roots natively.
 */
function toWindowsPath(lexicalPath: string): string {
  return win32.normalize(lexicalPath)
}

/** The path form the OS shell expects: Windows form on win32, lexical elsewhere. */
function toShellPath(lexicalPath: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? toWindowsPath(lexicalPath) : lexicalPath
}

/** Containment failures are indistinguishable from missing paths (spec Errors). */
function notFound(channel: string): AppError {
  return new AppError('not_found', 'File not found.', channel)
}

/** Local-only and not-yet-remote surfaces of an SSH project (spec Errors). */
function unsupportedSsh(channel: string): AppError {
  return new AppError('unsupported', 'This action is not available for SSH projects.', channel)
}

function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * Canonical containment: the target equals the root or sits below it. Drive
 * roots carry a trailing separator ('D:/') while child paths do not, so both
 * sides are compared stripped ('D:', '' for '/'); a bare POSIX root strips to
 * '' and the resulting '/' prefix keeps every absolute path contained.
 */
function isContained(root: string, target: string): boolean {
  const rootPrefix = root.replace(/\/+$/, '')
  const targetPrefix = target.replace(/\/+$/, '')
  return targetPrefix === rootPrefix || targetPrefix.startsWith(`${rootPrefix}/`)
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

/**
 * Text/binary/too-large classification shared by the local and the remote
 * read (spec Behaviour 10): NUL in the sniff window or a non-UTF-8 body is
 * binary, above 2 MB is too-large, everything else is text.
 */
function classifyPreview(content: Uint8Array, size: number, fileName: string): FilePreview {
  if (size > PREVIEW_MAX_BYTES) {
    return { kind: 'too-large', size }
  }
  if (hasNulByte(content, BINARY_SNIFF_BYTES)) {
    return { kind: 'binary' }
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(content)
    return { kind: 'text', content: text, language: mapExtensionToLanguage(fileName) }
  } catch {
    // Not decodable as UTF-8 (spec Behaviour 10).
    return { kind: 'binary' }
  }
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
      return {
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
      }
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
  readonly #remote?: (target: SshTarget) => FilesRemoteAdapter
  readonly #openExternal: (absolutePath: string) => Promise<string>
  readonly #showInFolder: (absolutePath: string) => void
  readonly #trashItem: (absolutePath: string) => Promise<void>
  readonly #platform: NodeJS.Platform

  constructor(deps: FilesServiceDeps) {
    this.#projects = deps.projects
    this.#fs = deps.fs ?? nodeFsAdapter
    this.#remote = deps.remote
    this.#openExternal = deps.openExternal
    this.#showInFolder = deps.showInFolder
    this.#trashItem = deps.trashItem
    this.#platform = deps.platform ?? process.platform
  }

  /** One directory level of the project tree (null = project root). */
  async list(projectId: string, relativePath: string | null): Promise<FileEntry[]> {
    const channel = 'files:list'
    const projectPath = this.#projectPath(projectId, channel)
    const environment = projectEnvironment(projectPath)
    if (environment.kind === 'ssh') {
      return this.#listRemote(environment.target, relativePath, channel)
    }
    const { target: dir, requestRel } = await this.#locate(projectPath, relativePath, channel)

    let listed: FilesFsEntry[]
    try {
      listed = await this.#fs.readdir(dir)
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
        const stats = await this.#fs.stat(joinProjectPath(dir, entry.name))
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
    const projectPath = this.#projectPath(projectId, channel)
    const environment = projectEnvironment(projectPath)
    if (environment.kind === 'ssh') {
      return this.#readRemote(environment.target, relativePath, channel)
    }
    const { target: file } = await this.#locate(projectPath, relativePath, channel)

    const stats = await this.#fs.stat(file)
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
      content = await this.#fs.readFile(file)
    } catch {
      throw notFound(channel)
    }
    return classifyPreview(content, stats.size, posix.basename(file))
  }

  /**
   * Validates a file for a preview window (file-preview-window Behaviour 3):
   * the same containment rules as read, and the target must be a file.
   */
  async previewTarget(projectId: string, relativePath: string): Promise<{ fileName: string }> {
    const channel = 'files:openInWindow'
    const projectPath = this.#projectPath(projectId, channel)
    // A remote preview window is a local-only surface (spec ssh-projects
    // Behaviour 11): rejected before any local path is derived.
    this.#requireLocal(projectPath, channel)
    const { target } = await this.#locate(projectPath, relativePath, channel)
    const stats = await this.#fs.stat(target)
    if (stats === null || !stats.isFile) {
      throw notFound(channel)
    }
    return { fileName: posix.basename(toPosix(relativePath)) }
  }

  /**
   * Change fingerprint of one file for preview-window polling
   * (file-preview-window Behaviour 9-10): size and mtime, or null when the
   * file is missing or no longer resolves inside the project. Only the
   * service's own not-found errors map to null; other failures propagate.
   */
  async fingerprint(projectId: string, relativePath: string): Promise<string | null> {
    let target: string
    try {
      // The project lookup sits inside the guard as well: an unknown project
      // fingerprints as missing, like a missing file (file-preview-window
      // Behaviour 9-10). A local-only rejection of an SSH project stays an
      // error because its code is `unsupported`, not `not_found`.
      const projectPath = this.#projectPath(projectId, 'preview:read')
      this.#requireLocal(projectPath, 'preview:read')
      ;({ target } = await this.#locate(projectPath, relativePath, 'preview:read'))
    } catch (error) {
      if (error instanceof AppError && error.code === 'not_found') {
        return null
      }
      throw error
    }
    const stats = await this.#fs.stat(target)
    if (stats === null || !stats.isFile) {
      return null
    }
    return `${stats.size}:${stats.mtimeMs}`
  }

  /** Opens the file with the OS default application (spec Behaviour 11). */
  async openExternal(projectId: string, relativePath: string): Promise<void> {
    const channel = 'files:openExternal'
    const projectPath = this.#projectPath(projectId, channel)
    this.#requireLocal(projectPath, channel)
    const { target } = await this.#locate(projectPath, relativePath, channel)
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
    const projectPath = this.#projectPath(projectId, channel)
    this.#requireLocal(projectPath, channel)
    const root = toPosix(projectPath)
    const stats = await this.#fs.stat(root)
    if (stats === null || !stats.isDirectory) {
      throw notFound(channel)
    }
    const failure = await this.#openExternal(root)
    if (failure !== '') {
      throw new AppError('unknown', 'Failed to open the file externally.', channel)
    }
  }

  /** Reveals the entry in Explorer (spec Behaviour 21). */
  async showInFolder(projectId: string, relativePath: string): Promise<void> {
    const channel = 'files:showInFolder'
    const projectPath = this.#projectPath(projectId, channel)
    this.#requireLocal(projectPath, channel)
    const { lexicalTarget } = await this.#locate(projectPath, relativePath, channel)
    try {
      this.#showInFolder(toShellPath(lexicalTarget, this.#platform))
    } catch {
      throw new AppError('unknown', 'Failed to show the item in the file explorer.', channel)
    }
  }

  /**
   * Moves the entry to the Windows Recycle Bin (spec Behaviour 23). A
   * rejection stops here: this method never removes the path directly.
   */
  async trash(projectId: string, relativePath: string): Promise<void> {
    const channel = 'files:trash'
    const projectPath = this.#projectPath(projectId, channel)
    this.#requireLocal(projectPath, channel)
    const { lexicalTarget } = await this.#locate(projectPath, relativePath, channel)
    try {
      await this.#trashItem(toShellPath(lexicalTarget, this.#platform))
    } catch {
      throw new AppError('unknown', 'Failed to move the item to the Recycle Bin.', channel)
    }
  }

  /** The stored project path, or the not-found error for an unknown project. */
  #projectPath(projectId: string, channel: string): string {
    const project = this.#projects.get(projectId)
    if (project === null) {
      throw new AppError('not_found', 'Project not found.', channel)
    }
    return project.path
  }

  /** Rejects a local-only surface of an SSH project (spec Behaviour 11). */
  #requireLocal(projectPath: string, channel: string): void {
    if (projectEnvironment(projectPath).kind === 'ssh') {
      throw unsupportedSsh(channel)
    }
  }

  /** One remote directory level through the transport-selected adapter. */
  async #listRemote(
    target: SshTarget,
    relativePath: string | null,
    channel: string,
  ): Promise<FileEntry[]> {
    const { adapter, remoteTarget, requestRel } = this.#locateRemote(target, relativePath, channel)
    const leaf = requestRel === '' ? null : requestRel.slice(requestRel.lastIndexOf('/') + 1)
    if (leaf !== null && EXCLUDED_DIRECTORY_NAMES.has(leaf.toLowerCase())) {
      // A listing of an excluded directory is unreachable, exactly like the
      // local branch (spec Behaviour 5).
      throw notFound(channel)
    }
    const listing = await adapter.list(remoteTarget)
    if (listing === null || !isContained(listing.realRoot, listing.realTarget)) {
      throw notFound(channel)
    }
    const entries: FileEntry[] = []
    for (const entry of listing.entries) {
      // A broken symlink or a special file has no usable kind, matching the
      // local stat-based classification.
      if (entry.kind === 'symlink') {
        continue
      }
      if (entry.kind === 'directory' && EXCLUDED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
        continue
      }
      entries.push({
        name: entry.name,
        relativePath: requestRel === '' ? entry.name : `${requestRel}/${entry.name}`,
        kind: entry.kind,
      })
    }
    entries.sort(compareEntries)
    return entries
  }

  /** One remote file read through the transport-selected adapter. */
  async #readRemote(
    target: SshTarget,
    relativePath: string,
    channel: string,
  ): Promise<FilePreview> {
    const { adapter, remoteTarget } = this.#locateRemote(target, relativePath, channel)
    const file = await adapter.read(remoteTarget)
    if (file === null || !isContained(file.realRoot, file.realTarget)) {
      throw notFound(channel)
    }
    // The remote script caps its read at 2 MB plus one byte, so a file that
    // grew between `wc -c` and `head -c` still cannot exceed the limit.
    const size = Math.max(file.size, file.content.byteLength)
    return classifyPreview(file.content, size, posix.basename(file.realTarget))
  }

  /**
   * Resolves a request against an SSH project. No local path is derived from
   * the SSH URL: the remote root is the stored target path, lexical escapes
   * are rejected here and canonical escapes by the adapter's `pwd -P` result.
   */
  #locateRemote(
    target: SshTarget,
    relativePath: string | null,
    channel: string,
  ): { adapter: FilesRemoteAdapter; root: string; remoteTarget: string; requestRel: string } {
    const adapter = this.#remote?.(target)
    if (adapter === undefined) {
      throw unsupportedSsh(channel)
    }
    const root = target.path
    if (relativePath === null) {
      return { adapter, root, remoteTarget: root, requestRel: '' }
    }
    const input = relativePath
    if (input.startsWith('/') || input.includes('\u0000')) {
      // Absolute forms and NUL are rejected before any remote call, and the
      // path is otherwise passed through unchanged: a backslash is an ordinary
      // POSIX name character, so the local Windows conversion must not run here
      // (spec Behaviour 10). Unlike the local branch, `:` is a valid remote
      // name.
      throw notFound(channel)
    }
    // A backslash is an ordinary POSIX name character, so the registered root
    // may contain one. Only the request is joined to it: the Windows-to-POSIX
    // conversion of joinProjectPath would rewrite the root too, and every
    // descent would then miss the registered directory (spec Behaviour 10).
    const remoteTarget = posix.join(root, input)
    if (remoteTarget !== root && !remoteTarget.startsWith(`${root}/`)) {
      // A crafted `..` form never reaches the host (spec Errors).
      throw notFound(channel)
    }
    const requestRel = posix.relative(root, remoteTarget)
    const segments = requestRel === '' ? [] : requestRel.split('/')
    for (const segment of segments.slice(0, -1)) {
      if (EXCLUDED_DIRECTORY_NAMES.has(segment.toLowerCase())) {
        throw notFound(channel)
      }
    }
    return { adapter, root, remoteTarget, requestRel }
  }

  /**
   * Resolves a request path against the registered project root and enforces
   * containment on the canonical (symlink-resolved) path.
   */
  async #locate(
    projectPath: string,
    relativePath: string | null,
    channel: string,
  ): Promise<{ root: string; target: string; requestRel: string; lexicalTarget: string }> {
    if (projectEnvironment(projectPath).kind === 'ssh') {
      // Invariant: an SSH path never becomes a local path (spec ssh-projects
      // Behaviour 11). Callers branch on the transport before reaching here.
      throw unsupportedSsh(channel)
    }
    const root = toPosix(projectPath)
    if (relativePath === null) {
      return { root, target: root, requestRel: '', lexicalTarget: root }
    }
    const input = toPosix(relativePath)
    if (isAbsolutePosix(input) || input.includes(':')) {
      // Absolute forms and NTFS alternate data streams (file.txt:stream —
      // content inside a file but invisible to the tree) resolve as
      // not-found, like every other rejected shape (spec Errors).
      throw notFound(channel)
    }
    const target = joinProjectPath(root, input)

    const realRoot = await this.#fs.realpath(root)
    const realTarget = await this.#fs.realpath(target)
    if (realRoot === null || realTarget === null) {
      throw notFound(channel)
    }
    const rootPosix = toPosix(realRoot)
    const targetPosix = toPosix(realTarget)
    if (!isContained(rootPosix, targetPosix)) {
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
    // Shell reveal and trash use the joined lexical path. The returned
    // `target` stays the symlink-resolved path that list and read use.
    return { root: rootPosix, target: targetPosix, requestRel, lexicalTarget: target }
  }
}
