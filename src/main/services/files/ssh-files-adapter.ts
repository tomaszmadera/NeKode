import type { SshTarget } from '@shared/ssh-target'
import type { SshScriptClient } from '../ssh/ssh-client'
import {
  type FilesFsEntry,
  type FilesRemoteAdapter,
  type FilesRemoteFile,
  type FilesRemoteListing,
  PREVIEW_MAX_BYTES,
} from './files-service'

// Remote files adapter for an SSH project (spec ssh-projects Behaviour 10,
// Data/API, Business rules). One invocation answers one request: the script
// changes into the project root, resolves canonical paths with `pwd -P`,
// classifies entries with `test -d/-f/-L`, reads sizes with `wc -c` and caps a
// read with `head -c` at 2 MB plus one byte. The payload follows the per-call
// nonce marker and is NUL-delimited, so login chatter is never data.
//
// Portable baseline only (spec Business rules): POSIX `sh`, `pwd -P`,
// `readlink`, `wc`, `head`, `printf`, `test`. No `find -maxdepth`, no `stat`,
// no `readlink -f`, no GNU-only flag. The scripts also refuse a canonical
// target outside the canonical root, so outside content never leaves the host.

/** Remote read cap: 2 MB plus one byte, enforced on the host. */
export const SSH_FILE_READ_LIMIT_BYTES = PREVIEW_MAX_BYTES + 1

/**
 * One directory level. `$1` is the registered project root, `$2` the requested
 * directory. Fields: canonical root, canonical directory, then a name/kind
 * record per entry (kind `d`, `f` or `l` for a broken link).
 */
const LIST_SCRIPT = [
  'cd "$1" || exit 111',
  'root=$(pwd -P) || exit 111',
  'cd "$2" || exit 111',
  'dir=$(pwd -P) || exit 111',
  'case $dir in "$root"|"$root"/*) ;; *) exit 111 ;; esac',
  `printf '%s\\0%s\\0' "$root" "$dir"`,
  'for entry in "$2"/* "$2"/.[!.]* "$2"/..?*; do',
  '  if test -d "$entry"; then kind=d',
  '  elif test -f "$entry"; then kind=f',
  '  elif test -L "$entry"; then kind=l',
  '  else continue',
  '  fi',
  `  printf '%s\\0%s\\0' "\${entry##*/}" "$kind"`,
  'done',
].join('\n')

/**
 * One file read. `$1` is the registered project root, `$2` the requested file.
 * Fields: canonical root, canonical target, kind, `wc -c` size, then the raw
 * content (at most SSH_FILE_READ_LIMIT_BYTES). A symlink chain on the final
 * component is followed with `readlink` and each parent is canonicalized, so a
 * link leaving the root is rejected instead of followed.
 */
const READ_SCRIPT = [
  'cd "$1" || exit 111',
  'root=$(pwd -P) || exit 111',
  'case $2 in',
  '  */*) parent=${2%/*}; leaf=${2##*/} ;;',
  '  *) parent=.; leaf=$2 ;;',
  'esac',
  'test -n "$parent" || parent=/',
  'real=$(cd "$parent" || exit 111; pwd -P) || exit 111',
  'if test "$real" = /; then target=/$leaf; else target=$real/$leaf; fi',
  'count=0',
  'while test -L "$target"; do',
  '  count=$((count+1))',
  '  if test "$count" -gt 40; then exit 111; fi',
  '  link=$(readlink "$target") || exit 111',
  '  case $link in',
  '    /*) next=$link ;;',
  '    *) next=$real/$link ;;',
  '  esac',
  '  case $next in',
  '    */*) parent=${next%/*}; leaf=${next##*/} ;;',
  '    *) parent=.; leaf=$next ;;',
  '  esac',
  '  test -n "$parent" || parent=/',
  '  real=$(cd "$parent" || exit 111; pwd -P) || exit 111',
  '  if test "$real" = /; then target=/$leaf; else target=$real/$leaf; fi',
  'done',
  'case $target in "$root"|"$root"/*) ;; *) exit 111 ;; esac',
  'if test -d "$target"; then kind=d',
  'elif test -f "$target"; then kind=f',
  'else kind=n',
  'fi',
  `printf '%s\\0%s\\0%s\\0' "$root" "$target" "$kind"`,
  'if test "$kind" = f; then',
  '  size=$(wc -c < "$target") || size=0',
  `  printf '%s\\0' "$size"`,
  `  head -c ${SSH_FILE_READ_LIMIT_BYTES} "$target"`,
  'fi',
].join('\n')

const decoder = new TextDecoder()

function decode(value: Uint8Array | undefined): string {
  return value === undefined ? '' : decoder.decode(value)
}

/** Joins content fields that the NUL field separator split apart. */
function joinContent(fields: Uint8Array[]): Uint8Array {
  if (fields.length === 0) {
    return new Uint8Array()
  }
  if (fields.length === 1) {
    return fields[0] ?? new Uint8Array()
  }
  const total = fields.reduce((sum, field) => sum + field.byteLength, 0) + fields.length - 1
  const joined = new Uint8Array(total)
  let offset = 0
  for (const [index, field] of fields.entries()) {
    if (index > 0) {
      joined[offset] = 0
      offset += 1
    }
    joined.set(field, offset)
    offset += field.byteLength
  }
  return joined
}

function entryKind(value: string): FilesFsEntry['kind'] | null {
  if (value === 'd') return 'directory'
  if (value === 'f') return 'file'
  if (value === 'l') return 'symlink'
  return null
}

export class SshFilesAdapter implements FilesRemoteAdapter {
  readonly #client: SshScriptClient
  readonly #target: SshTarget

  constructor(client: SshScriptClient, target: SshTarget) {
    this.#client = client
    this.#target = target
  }

  /** One invocation for one directory level of the project. */
  async list(dir: string): Promise<FilesRemoteListing | null> {
    const result = await this.#client.runScript(this.#target, LIST_SCRIPT, [this.#target.path, dir])
    if (result.exitCode !== 0) {
      // A failed `cd` or a canonical target outside the root is a missing
      // path to the caller (spec Errors).
      return null
    }
    const [realRoot, realTarget] = result.fields
    if (realRoot === undefined || realTarget === undefined) {
      return null
    }
    const entries: FilesFsEntry[] = []
    for (let index = 2; index + 1 < result.fields.length; index += 2) {
      const name = result.fields[index] ?? ''
      if (name === '') {
        break
      }
      const kind = entryKind(result.fields[index + 1] ?? '')
      if (kind === null) {
        continue
      }
      entries.push({ name, kind })
    }
    return { realRoot, realTarget, entries }
  }

  /** One invocation for one file: containment, size and capped content. */
  async read(path: string): Promise<FilesRemoteFile | null> {
    const result = await this.#client.runScriptBytes(this.#target, READ_SCRIPT, [
      this.#target.path,
      path,
    ])
    if (result.exitCode !== 0) {
      return null
    }
    const [rootField, targetField, kindField, sizeField] = result.fields
    if (rootField === undefined || targetField === undefined || decode(kindField) !== 'f') {
      // Missing, a directory or an unresolvable link: the same error as a
      // missing local file.
      return null
    }
    const size = Number.parseInt(decode(sizeField).trim(), 10)
    return {
      realRoot: decode(rootField),
      realTarget: decode(targetField),
      size: Number.isFinite(size) && size >= 0 ? size : 0,
      content: joinContent(result.fields.slice(4)),
    }
  }
}
