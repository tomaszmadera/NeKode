// One regular file in a project's configured handoff directory (spec
// handoff-resume-flow Data/API), newest first. `path` is the resolved
// absolute path; the Resume command composes the project-relative form from
// it (shared `relativeToProject`, absolute when outside the root).
export interface HandoffEntry {
  name: string
  path: string
  modifiedAt: string
}

// ---------------------------------------------------------------------------
// Handoff match (kanban task launch amendment, stage 4; NEKODE-30 stage 2). The
// matcher reads the project's configured handoff directory and returns file
// metadata, not file bodies. The only link between a work item and a handoff is
// the full ref carried in the file name.
// ---------------------------------------------------------------------------

/**
 * How a scanned file matched the work item. `filename` is a ref-named or
 * ref-prefixed file; `none` is a readable file whose name does not carry the
 * ref (never a candidate).
 */
export type HandoffMatchKind = 'filename' | 'none'

/** One regular, readable `.md` file of the configured handoff directory. */
export interface HandoffFileInfo {
  name: string
  /** Display path: project-relative inside the root, absolute otherwise. */
  path: string
  /** ISO modification time; also the stamp a later confirm rechecks. */
  modifiedAt: string
  matchKind: HandoffMatchKind
}

/** A readable file the scan could not use as a candidate; shown as a warning. */
export interface HandoffRejection {
  name: string
  path: string
  /** Visible, user-facing reason (size cap, encoding, read failure). */
  reason: string
}

/**
 * One handoff scan for a work item. `not-configured` is an unconfigured
 * directory; `error` is a directory read failure and is never shown as an
 * empty set. Both are distinct from a `ready` scan that has no candidates.
 */
export type HandoffCandidatesResult =
  | { state: 'not-configured' }
  | { state: 'error'; message: string }
  | {
      state: 'ready'
      /** Readable files, modification time descending (case-insensitive name tie-break). */
      files: HandoffFileInfo[]
      /** Files with a visible rejection reason; never hide the good candidates. */
      rejections: HandoffRejection[]
    }
