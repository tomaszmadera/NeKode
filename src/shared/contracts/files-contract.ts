// One entry of a project file-tree listing (spec Data/API): one directory
// level, already filtered in main (default directory exclusions).
export interface FileEntry {
  name: string
  /** Path relative to the project root, '/'-separated ('' is never used: the root itself has no entry). */
  relativePath: string
  kind: 'file' | 'directory'
}

// Read-only file preview classification (spec Data/API / Behaviour 10):
// text at or below the preview threshold, too-large above it, binary when
// the content is not decodable as UTF-8 (or sniffs binary).
export type FilePreview =
  | { kind: 'text'; content: string; language: string | null }
  | { kind: 'too-large'; size: number }
  | { kind: 'binary' }
