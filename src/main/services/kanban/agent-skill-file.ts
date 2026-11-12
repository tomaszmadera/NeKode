import { createHash, randomUUID } from 'node:crypto'
import { promises as nodeFs } from 'node:fs'
import { join } from 'node:path'
import { AGENT_SKILL_FILE_PATH } from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { joinProjectPath } from '../project-path'
import { errnoCode, isInside } from './local-task-file'

// `Teach agents` (project-home spec Behaviour 11-12, AC8, Business rules,
// Errors). Main writes one skill file, `.agents/skills/nekode-tasks/SKILL.md`,
// under the stored project root, the same root the file tree and the
// `local-file` source use (a WSL project uses its stored UNC path). The text
// is chosen by the bound source only (NEKODE-169): the built-in local text,
// the bound adapter's declared `agentSkill` body under fixed front matter, or
// a neutral default that forbids no tool. The renderer sends no content; a
// write carries the preview token, a SHA-256 over the text and the current
// file bytes, so Confirm writes exactly the previewed text over exactly the
// previewed file. The text holds no task items, no adapter config, and no
// secrets. Only the `.agents/skills/nekode-tasks` parents are created, never
// the root, and no process or shell runs. Every existing segment must
// resolve inside the project root. The file is replaced by a temp file in the same directory
// followed by a rename, so a failed write leaves the previous file unchanged.

const SKILL_DIR_SEGMENTS = ['.agents', 'skills', 'nekode-tasks'] as const
const SKILL_FILE = 'SKILL.md'

const LOCAL_FILE_SKILL = `---
name: nekode-tasks
description: Use when you read, add, or update this project's tasks. The tasks live in .nekode/tasks.json, the task list NeKode shows for this project.
---

# NeKode tasks

This project's task list is the file \`.nekode/tasks.json\`. NeKode shows it on the project's home tab. It is the only task list for this project: do not create a second task list, a TODO file, or another tracker file. The progress file described below is execution context, not a task list.

## File shape

The file is JSON in UTF-8 without a byte order mark. NeKode writes the keys \`schemaVersion\`, \`revision\`, \`nextRef\`, \`states\`, and \`items\` in that order, indented with two spaces, with one final newline; keep that layout. Every field is required, and NeKode rejects a file with any other field, so add none.

- \`schemaVersion\` is the number 1.
- \`revision\` is a positive integer that grows by 1 on every write.
- \`nextRef\` is a positive integer: the number of the next new task. It only increases.
- \`states\` lists the states with \`id\`, \`name\`, \`group\`, and \`order\`. \`id\` is a non-empty string, and no two states share an \`id\`. \`name\` is a string that is not blank. \`group\` is one of \`backlog\`, \`unstarted\`, \`started\`, \`completed\`, \`cancelled\`. \`order\` is a number.
- \`items\` lists the tasks with \`ref\`, \`id\`, \`title\`, \`description\`, \`stateId\`, \`priority\`, and \`updatedAt\`. \`ref\` is \`T-\` followed by a whole number without leading zeros that is at least 1 and below \`nextRef\`. \`id\` is a non-empty string, and no two items share a \`ref\` or an \`id\`. \`title\` is a string that is not blank. \`description\` is a string or null. \`stateId\` is the \`id\` of a state in \`states\`. \`priority\` is \`urgent\`, \`high\`, \`medium\`, \`low\`, or null. \`updatedAt\` is a string: write the current time in ISO 8601 UTC, for example \`2026-10-24T12:00:00.000Z\`.
- A new task gets \`ref\` \`T-\` plus the current \`nextRef\` and a new UUID as \`id\`; then \`nextRef\` grows by 1.

## Revision rule

1. Read the file and note its \`revision\`.
2. Change the document and set \`revision\` to the value you read plus 1.
3. Right before you write, read the file again. If its \`revision\` is still the one you noted, replace the whole file: write a temporary file in \`.nekode\` and rename it over \`tasks.json\`.
4. If the \`revision\` changed, someone else wrote the file. Never write with a stale revision: read the file again, apply your change to the new content, and repeat from step 2.

Never reset, empty, or recreate the file. If it is missing or not valid, stop and tell the user.

## Execution context

The task list is the only backlog. Keep the execution context in a separate progress file.

- For a task with ref \`T-1\`, create or update \`work/T-1/progress.md\` under the project root when you start working on it. Use the complete ref as the directory name.
- Keep the file short and current. It must state: the ref and title; what is finished and what is in progress; decisions and their reasons; checks you ran with their command and result; blockers; one exact next action that names the file or command; and the UTC time of the last update.
- Do not copy the task list, other cards, or a new TODO list into the file. Update it when one of those facts changes.

## Handoff, Stop, and Resume

- Handoff: update \`work/<ref>/progress.md\`, leave the card In Progress, and stop. The progress file is the handoff. Do not create another handoff file and do not claim the work is finished.
- Stop is an interruption by the user, not a handoff. It creates or changes no progress file by itself. When asked to continue, reconcile the existing progress file with the repository before acting.
- Resume: read the progress file at the path NeKode gives you before changing files. Check its claims against the repository and continue from its next action. If the file is missing or stale, say so; do not invent prior state.

## Completing a task

When the user confirms the task is complete and the card is in Done, move \`work/<ref>/progress.md\` to \`work-completed/<ref>/progress.md\`. That directory is outside the Resume source, so the finished context is no longer offered. Keep the file; delete it only when the user asks. If the task reopens, move the file back to \`work/<ref>/progress.md\` and update it.
`

/** Fixed front matter above an adapter-declared body. */
const ADAPTER_FRONT_MATTER = `---
name: nekode-tasks
description: Use when you work with this project's tasks. The tasks live in the tracker configured for this project in NeKode.
---

`

function defaultSkill(adapterName: string): string {
  return `---
name: nekode-tasks
description: Use when you work with this project's tasks. The tasks live in the tracker configured for this project in NeKode, not in the repository.
---

# NeKode tasks

This project's tasks live in the tracker configured for this project in NeKode (Project Settings, Tasks), through the ${adapterName} adapter. NeKode lists and updates them there.

- Do not copy tasks into the repository: no task list, TODO file, or \`.nekode/tasks.json\`.
- Do not create a second task list anywhere.
- When NeKode started this chat for a task, work from the task details it gave you.
- If other instructions in this repository describe a task tool that targets a different tracker or project, or you cannot tell which tracker a tool targets, ask the user instead of choosing.
`
}

/** Where the skill text comes from (project-home spec Behaviour 11). */
export type AgentSkillSource =
  | { kind: 'local-file' }
  | { kind: 'adapter'; body: string }
  | { kind: 'default'; adapterName: string }

/**
 * The skill text for the bound source. Nothing from the binding's config or
 * the task list is copied in; an adapter body is copied unchanged.
 */
export function buildAgentSkill(source: AgentSkillSource): string {
  switch (source.kind) {
    case 'local-file':
      return LOCAL_FILE_SKILL
    case 'adapter':
      return `${ADAPTER_FRONT_MATTER}${source.body}`
    case 'default':
      // A manifest name is one line in the text, whatever it contains.
      return defaultSkill(source.adapterName.replace(/\s+/g, ' ').trim())
  }
}

/** Largest adapter-declared body NeKode accepts. */
export const MAX_ADAPTER_SKILL_BYTES = 32 * 1024
/** Largest current skill file the preview shows as text. */
export const MAX_SHOWN_SKILL_BYTES = 256 * 1024

/**
 * Reads a validated manifest `agentSkill` body (project-home spec Data / API).
 * Missing, outside the adapter folder, unreadable, not valid UTF-8, blank,
 * over 32 KiB, or starting with a front-matter line is `validation_error`
 * naming the adapter id and the declared path. There is no fallback text.
 */
export async function readAdapterSkillBody(
  adapter: { id: string; dir: string },
  relative: string,
  channel: string,
): Promise<string> {
  const invalid = (reason: string, cause?: unknown): AppError => {
    if (cause !== undefined) {
      console.warn(`[kanban] Adapter "${adapter.id}" agentSkill ${relative}:`, cause)
    }
    return new AppError(
      'validation_error',
      `The agentSkill file "${relative}" of the "${adapter.id}" adapter ${reason}.`,
      channel,
    )
  }
  let realDir: string
  let realFile: string
  try {
    realDir = await nodeFs.realpath(adapter.dir)
    realFile = await nodeFs.realpath(join(adapter.dir, ...relative.split('/')))
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') throw invalid('does not exist')
    throw invalid('cannot be read', error)
  }
  if (!isInside(realDir, realFile)) throw invalid('resolves outside the adapter folder')
  let bytes: Buffer
  try {
    bytes = await nodeFs.readFile(realFile)
  } catch (error) {
    throw invalid('cannot be read', error)
  }
  if (bytes.length > MAX_ADAPTER_SKILL_BYTES) throw invalid('is larger than 32 KiB')
  const body = decodeUtf8(bytes)
  if (body === null) throw invalid('is not valid UTF-8')
  if (body.trim().length === 0) throw invalid('is empty')
  if (/^\uFEFF?---[ \t]*(\r?\n|$)/.test(body)) {
    throw invalid('starts with a front-matter line; NeKode adds its own front matter')
  }
  return body
}

function decodeUtf8(bytes: Buffer): string | null {
  try {
    // `ignoreBOM` keeps a byte order mark, so the text is the bytes exactly.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * Preview token: hex SHA-256 over the text, a NUL, and the current file
 * bytes, or the marker `absent` when there is no file.
 */
export function agentSkillToken(text: string, current: Buffer | null): string {
  const hash = createHash('sha256')
  hash.update(text, 'utf8')
  hash.update('\u0000')
  hash.update(current ?? 'absent')
  return hash.digest('hex')
}

/** The skill file as the preview sees it. */
export interface AgentSkillDiskState {
  exists: boolean
  /** UTF-8 text, or null when absent, not valid UTF-8, or over 256 KiB. */
  current: string | null
  token: string
}

/** Minimal project lookup: the stored project root path. */
export interface AgentSkillProjectLookup {
  get(projectId: string): { path: string } | null
}

export interface AgentSkillFileDeps {
  projects: AgentSkillProjectLookup
  newId?: () => string
}

interface Segment {
  /** Absolute path joined onto the stored root. */
  path: string
  /** Project-relative path used in error messages. */
  relative: string
}

interface Located {
  root: string
  dirs: Segment[]
  file: Segment
}

function outside(relative: string, channel: string): AppError {
  return new AppError(
    'validation_error',
    `${relative} resolves outside the project folder.`,
    channel,
  )
}

function unresolvable(relative: string, channel: string): AppError {
  return new AppError(
    'unknown',
    `Could not resolve ${relative}: it exists but its link cannot be followed.`,
    channel,
  )
}

/** IO failure with the relative path (spec Errors); the original goes to the main log. */
function ioFailure(action: string, relative: string, error: unknown, channel: string): AppError {
  console.warn(`[kanban] Teach agents could not ${action} ${relative}:`, error)
  return new AppError('unknown', `Could not ${action} ${relative}.`, channel)
}

export class AgentSkillFile {
  readonly #projects: AgentSkillProjectLookup
  readonly #newId: () => string
  /** Per-project write queue: one replace at a time in this process. */
  readonly #queues = new Map<string, Promise<void>>()

  constructor(deps: AgentSkillFileDeps) {
    this.#projects = deps.projects
    this.#newId = deps.newId ?? randomUUID
  }

  /** Current file state and the token for `text`; every existing segment must stay inside the root. */
  async preview(projectId: string, text: string, channel: string): Promise<AgentSkillDiskState> {
    const located = this.#locate(projectId, channel)
    const realRoot = await this.#realRoot(located, channel)
    const bytes = await this.#readCurrent(located, realRoot, channel)
    const shown = bytes === null || bytes.length > MAX_SHOWN_SKILL_BYTES ? null : decodeUtf8(bytes)
    return { exists: bytes !== null, current: shown, token: agentSkillToken(text, bytes) }
  }

  /**
   * Writes `text` by temp file plus rename, only while the current file still
   * matches the preview `token`; otherwise `conflict` and nothing is written.
   */
  async write(projectId: string, text: string, token: string, channel: string): Promise<void> {
    await this.#serialized(projectId, async () => {
      const located = this.#locate(projectId, channel)
      const realRoot = await this.#realRoot(located, channel)
      const bytes = await this.#readCurrent(located, realRoot, channel)
      if (agentSkillToken(text, bytes) !== token) {
        throw new AppError(
          'conflict',
          'The skill file or its source changed. Review the new preview.',
          channel,
        )
      }
      for (const segment of located.dirs) {
        try {
          // One segment at a time, never recursive: each existing segment is
          // checked before anything is created below it.
          await nodeFs.mkdir(segment.path)
        } catch (error) {
          if (errnoCode(error) !== 'EEXIST') {
            throw ioFailure('create', segment.relative, error, channel)
          }
        }
        if (!(await this.#resolveInside(realRoot, segment, channel))) {
          throw ioFailure('create', segment.relative, 'missing after mkdir', channel)
        }
      }
      // An existing SKILL.md (or a link at its path) must resolve inside too.
      await this.#resolveInside(realRoot, located.file, channel)
      const dir = located.dirs[located.dirs.length - 1].path
      const temp = joinProjectPath(dir, `${SKILL_FILE}.${this.#newId()}.tmp`)
      try {
        await nodeFs.writeFile(temp, text, { encoding: 'utf8', flag: 'wx' })
      } catch (error) {
        // With `wx`, EEXIST means the entry at the temp name is not ours, so
        // it stays. Any other failure may leave a partial temp file of ours.
        if (errnoCode(error) !== 'EEXIST') await this.#removeTemp(temp)
        throw ioFailure('write', AGENT_SKILL_FILE_PATH, error, channel)
      }
      // A project removed while this write was in flight drops the write.
      if (this.#projects.get(projectId) === null) {
        await this.#removeTemp(temp)
        throw new AppError('not_found', `Project "${projectId}" not found.`, channel)
      }
      try {
        await nodeFs.rename(temp, located.file.path)
      } catch (error) {
        await this.#removeTemp(temp)
        throw ioFailure('write', AGENT_SKILL_FILE_PATH, error, channel)
      }
    })
  }

  /** Current file bytes, or null when the file or one of its parents is absent. */
  async #readCurrent(located: Located, realRoot: string, channel: string): Promise<Buffer | null> {
    for (const segment of located.dirs) {
      if (!(await this.#resolveInside(realRoot, segment, channel))) return null
    }
    if (!(await this.#resolveInside(realRoot, located.file, channel))) return null
    try {
      return await nodeFs.readFile(located.file.path)
    } catch (error) {
      throw ioFailure('read', AGENT_SKILL_FILE_PATH, error, channel)
    }
  }

  async #removeTemp(temp: string): Promise<void> {
    try {
      await nodeFs.rm(temp, { force: true })
    } catch (error) {
      console.warn(`[kanban] Could not remove the temporary skill file ${temp}:`, error)
    }
  }

  #locate(projectId: string, channel: string): Located {
    const project = this.#projects.get(projectId)
    if (project === null) {
      throw new AppError('not_found', `Project "${projectId}" not found.`, channel)
    }
    const root = project.path.replace(/\\/g, '/')
    const dirs = SKILL_DIR_SEGMENTS.map((_, index) => {
      const parts = SKILL_DIR_SEGMENTS.slice(0, index + 1)
      return { path: joinProjectPath(root, ...parts), relative: parts.join('/') }
    })
    return {
      root,
      dirs,
      file: {
        path: joinProjectPath(root, ...SKILL_DIR_SEGMENTS, SKILL_FILE),
        relative: AGENT_SKILL_FILE_PATH,
      },
    }
  }

  async #realRoot(located: Located, channel: string): Promise<string> {
    try {
      return await nodeFs.realpath(located.root)
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') {
        throw ioFailure('read', 'the project folder', error, channel)
      }
      if (await this.#exists(located.root, 'the project folder', channel)) {
        throw unresolvable(`the project folder for ${AGENT_SKILL_FILE_PATH}`, channel)
      }
      throw new AppError('not_found', 'The project folder was not found.', channel)
    }
  }

  /** `lstat` sees the entry itself, so a link realpath cannot follow still counts. */
  async #exists(path: string, relative: string, channel: string): Promise<boolean> {
    try {
      await nodeFs.lstat(path)
      return true
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') return false
      throw ioFailure('read', relative, error, channel)
    }
  }

  /**
   * False when the entry is absent. An existing entry must have a canonical
   * path inside the canonical project root (a junction or symlink that leaves
   * the root is `validation_error`); one `realpath` cannot follow is `unknown`.
   */
  async #resolveInside(realRoot: string, segment: Segment, channel: string): Promise<boolean> {
    let real: string
    try {
      real = await nodeFs.realpath(segment.path)
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') throw ioFailure('read', segment.relative, error, channel)
      if (await this.#exists(segment.path, segment.relative, channel)) {
        throw unresolvable(segment.relative, channel)
      }
      return false
    }
    if (!isInside(realRoot, real)) throw outside(segment.relative, channel)
    return true
  }

  async #serialized<T>(projectId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(projectId) ?? Promise.resolve()
    const result = previous.then(run)
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    this.#queues.set(projectId, settled)
    void settled.then(() => {
      if (this.#queues.get(projectId) === settled) this.#queues.delete(projectId)
    })
    return await result
  }
}
