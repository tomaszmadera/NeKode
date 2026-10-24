import { randomUUID } from 'node:crypto'
import { promises as nodeFs } from 'node:fs'
import { AGENT_SKILL_FILE_PATH, LOCAL_FILE_ADAPTER_ID } from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'
import { joinProjectPath } from '../project-path'
import { errnoCode, isInside } from './local-task-file'

// `Teach agents` (project-home spec Behaviour 11-12, AC8, Business rules,
// Errors). Main writes one skill file, `.agents/skills/nekode-tasks/SKILL.md`,
// under the stored project root, the same root the file tree and the
// `local-file` source use (a WSL project uses its stored UNC path). The text
// is built here from the bound source id; the renderer sends no content. It
// holds no task items, no adapter config, and no secrets. Only the
// `.agents/skills/nekode-tasks` parents are created, never the root, and no
// process or shell runs. Every existing segment must resolve inside the
// project root. The file is replaced by a temp file in the same directory
// followed by a rename, so a failed write leaves the previous file unchanged.

const SKILL_DIR_SEGMENTS = ['.agents', 'skills', 'nekode-tasks'] as const
const SKILL_FILE = 'SKILL.md'

const LOCAL_FILE_SKILL = `---
name: nekode-tasks
description: Use when you read, add, or update this project's tasks. The tasks live in .nekode/tasks.json, the task list NeKode shows for this project.
---

# NeKode tasks

This project's task list is the file \`.nekode/tasks.json\`. NeKode shows it on the project's home tab. It is the only task list for this project: do not create a second task list, a TODO file, or another tracker file.

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
`

const EXTERNAL_SKILL = `---
name: nekode-tasks
description: Use when you work with this project's tasks. The tasks live in the tracker configured for this project in NeKode, not in the repository, and they are added and updated in NeKode.
---

# NeKode tasks

This project's tasks live in the tracker configured for this project in NeKode (Project Settings, Tasks). NeKode lists and updates them there.

- Do not copy tasks into the repository: no task list, TODO file, or \`.nekode/tasks.json\`.
- Do not create a second task list anywhere.
- Do not call a kanban CLI recorded in this repository (for example a \`kanban\` skill or command under \`.agents/\`) to read or change these tasks. It may target a different tracker project.
- Work from the task details NeKode gave you in this chat, or ask the user.
`

/**
 * The skill text for the bound source id (spec Behaviour 11). Only the
 * branch depends on the id; nothing from the binding, its config, or the
 * task list is copied in.
 */
export function buildAgentSkill(adapterId: string): string {
  return adapterId === LOCAL_FILE_ADAPTER_ID ? LOCAL_FILE_SKILL : EXTERNAL_SKILL
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

  /** Whether the skill file exists; every existing segment must stay inside the root. */
  async exists(projectId: string, channel: string): Promise<boolean> {
    const located = this.#locate(projectId, channel)
    const realRoot = await this.#realRoot(located, channel)
    for (const segment of located.dirs) {
      if (!(await this.#resolveInside(realRoot, segment, channel))) return false
    }
    return await this.#resolveInside(realRoot, located.file, channel)
  }

  /** Writes the given text to the skill file by temp file plus rename. */
  async write(projectId: string, text: string, channel: string): Promise<void> {
    await this.#serialized(projectId, async () => {
      const located = this.#locate(projectId, channel)
      const realRoot = await this.#realRoot(located, channel)
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
