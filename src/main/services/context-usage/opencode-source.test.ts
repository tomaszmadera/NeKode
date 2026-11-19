import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatInfo } from '@shared/contracts/chats-contract'
import type { ProjectInfo } from '@shared/contracts/projects-contract'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentLaunch } from '../agent-session-registry'
import { ContextUsageService } from './context-usage-service'
import { openCodeMessageTokens, readOpenCodeSnapshot } from './opencode-source'

// OpenCode context (spec left-panel Data / API, NEKODE-167): the tile's number
// is the prompt size of the session's latest completed turn, read from
// OpenCode's own WAL-mode SQLite database without changing it, and a chat shows
// a number only for a session it can claim without doubt.
const roots: string[] = []
const writers: Database.Database[] = []

afterEach(() => {
  while (writers.length > 0) writers.pop()?.close()
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'nekode-opencode-'))
  roots.push(root)
  return root
}

const BASE = Date.parse('2026-11-19T12:00:00.000Z')

/** The schema subset OpenCode 1.18.31 uses for sessions and messages. */
function openCodeDb(root: string, sessionColumns = 'parent_id TEXT,'): Database.Database {
  const dir = join(root, 'opencode')
  mkdirSync(dir, { recursive: true })
  const db = new Database(join(dir, 'opencode.db'))
  db.pragma('journal_mode = WAL')
  // Keep every write in the WAL so the test also proves the WAL stays untouched.
  db.pragma('wal_autocheckpoint = 0')
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, ${sessionColumns} directory TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
  `)
  writers.push(db)
  return db
}

function addSession(
  db: Database.Database,
  id: string,
  directory: string,
  createdAt: number,
  parentId: string | null = null,
): void {
  db.prepare(
    'INSERT INTO session (id, parent_id, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)',
  ).run(id, parentId, directory, createdAt, createdAt)
}

function completed(input: number, read: number, write: number, at: number): string {
  return JSON.stringify({
    role: 'assistant',
    tokens: {
      total: input + read + write + 50,
      input,
      output: 50,
      reasoning: 0,
      cache: { read, write },
    },
    time: { created: at - 1000, completed: at },
    finish: 'stop',
  })
}

function inProgress(at: number): string {
  return JSON.stringify({
    role: 'assistant',
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: at },
  })
}

let messageSeq = 0
function addMessage(db: Database.Database, sessionId: string, at: number, data: string): void {
  messageSeq += 1
  db.prepare(
    'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)',
  ).run(`msg_${String(messageSeq).padStart(6, '0')}`, sessionId, at, at, data)
}

function project(id: string, path: string): ProjectInfo {
  return { id, name: 'Demo', path, runtimeLabel: null }
}

function chat(id: string, projectId: string): ChatInfo {
  return { id, projectId, name: 'n', agentName: 'OpenCode' }
}

function launch(projectPath: string, startedAt: number): AgentLaunch {
  return { agentName: 'OpenCode', sessionId: null, startedAt, projectPath }
}

function service(
  root: string,
  projects: ProjectInfo[],
  chats: ChatInfo[],
  launches: Record<string, AgentLaunch>,
): ContextUsageService {
  return new ContextUsageService({
    projects: { list: () => projects },
    chats: { list: (projectId) => chats.filter((entry) => entry.projectId === projectId) },
    launch: (chatId) => launches[chatId] ?? null,
    claudeConfigDir: () => join(root, 'claude'),
    codexConfigDir: () => join(root, 'codex'),
    openCodeDatabase: () => join(root, 'opencode', 'opencode.db'),
  })
}

describe('openCodeMessageTokens', () => {
  it('sums input, cache read and cache write of a completed assistant turn', () => {
    expect(openCodeMessageTokens(completed(842, 67_136, 0, BASE))).toBe(67_978)
  })

  it('rejects in-progress, aborted, user and malformed rows', () => {
    expect(openCodeMessageTokens(inProgress(BASE))).toBeNull()
    expect(openCodeMessageTokens(completed(0, 0, 0, BASE))).toBeNull()
    expect(openCodeMessageTokens(JSON.stringify({ role: 'user', time: { created: 1 } }))).toBeNull()
    expect(openCodeMessageTokens('{"role":"assistant","tokens":')).toBeNull()
  })
})

describe('readOpenCodeSnapshot', () => {
  it('takes the latest completed turn over a turn still in progress and skips subagents', () => {
    const root = tempRoot()
    const db = openCodeDb(root)
    addSession(db, 'ses_main', '/work/demo', BASE)
    addSession(db, 'ses_child', '/work/demo', BASE + 10, 'ses_main')
    addMessage(db, 'ses_main', BASE + 100, completed(10, 1000, 0, BASE + 200))
    addMessage(db, 'ses_main', BASE + 300, completed(20, 64_000, 500, BASE + 400))
    addMessage(db, 'ses_main', BASE + 500, inProgress(BASE + 500))
    addMessage(db, 'ses_child', BASE + 600, completed(1, 999_000, 0, BASE + 700))

    const snapshot = readOpenCodeSnapshot(join(root, 'opencode', 'opencode.db'), BASE - 1000)
    expect(snapshot?.sessions).toEqual([
      { id: 'ses_main', directory: '/work/demo', createdAt: BASE },
    ])
    expect(snapshot?.tokens.get('ses_main')).toBe(64_520)
    expect(snapshot?.tokens.has('ses_child')).toBe(false)
  })

  it('skips a malformed newest row and keeps the previous completed turn', () => {
    const root = tempRoot()
    const db = openCodeDb(root)
    addSession(db, 'ses_main', '/work/demo', BASE)
    addMessage(db, 'ses_main', BASE + 100, completed(5, 120_000, 0, BASE + 200))
    addMessage(db, 'ses_main', BASE + 300, '{"role":"assistant","tok')

    const snapshot = readOpenCodeSnapshot(join(root, 'opencode', 'opencode.db'), BASE - 1000)
    expect(snapshot?.tokens.get('ses_main')).toBe(120_005)
  })

  it('returns null for a missing database or a schema without the expected columns', () => {
    const root = tempRoot()
    expect(readOpenCodeSnapshot(join(root, 'opencode', 'opencode.db'), 0)).toBeNull()
    const db = openCodeDb(root, '')
    addMessage(db, 'ses_main', BASE, completed(1, 1, 1, BASE))
    expect(readOpenCodeSnapshot(join(root, 'opencode', 'opencode.db'), 0)).toBeNull()
  })

  it('leaves opencode.db and opencode.db-wal byte-for-byte unchanged', () => {
    const root = tempRoot()
    const db = openCodeDb(root)
    addSession(db, 'ses_main', '/work/demo', BASE)
    addMessage(db, 'ses_main', BASE + 100, completed(5, 120_000, 0, BASE + 200))
    const file = join(root, 'opencode', 'opencode.db')
    const before = [readFileSync(file), readFileSync(`${file}-wal`)]
    expect(before[1].length).toBeGreaterThan(0)

    expect(readOpenCodeSnapshot(file, 0)?.tokens.get('ses_main')).toBe(120_005)
    expect(readOpenCodeSnapshot(file, 0)?.tokens.get('ses_main')).toBe(120_005)

    expect(readFileSync(file).equals(before[0])).toBe(true)
    expect(readFileSync(`${file}-wal`).equals(before[1])).toBe(true)
  })

  it('leaves the files unchanged when it is the only connection to a database with a WAL', () => {
    const root = tempRoot()
    const db = openCodeDb(root)
    addSession(db, 'ses_main', '/work/demo', BASE)
    addMessage(db, 'ses_main', BASE + 100, completed(7, 90_000, 0, BASE + 200))
    // Copy the live files while the writer is open: the copy has a WAL that no
    // other connection holds, as after OpenCode exits or crashes, so a closing
    // connection that checkpointed would rewrite both files.
    const source = join(root, 'opencode', 'opencode.db')
    const dir = join(root, 'orphan')
    mkdirSync(dir)
    const file = join(dir, 'opencode.db')
    for (const suffix of ['', '-wal', '-shm'])
      copyFileSync(`${source}${suffix}`, `${file}${suffix}`)
    const before = [readFileSync(file), readFileSync(`${file}-wal`)]
    expect(before[1].length).toBeGreaterThan(0)

    expect(readOpenCodeSnapshot(file, 0)?.tokens.get('ses_main')).toBe(90_007)

    expect(readFileSync(file).equals(before[0])).toBe(true)
    expect(readFileSync(`${file}-wal`).equals(before[1])).toBe(true)
  })
})

describe('ContextUsageService with OpenCode', () => {
  it('claims the earliest session created after the launch and ignores older ones', () => {
    const root = tempRoot()
    const db = openCodeDb(root)
    // An older session in the same directory (for example one resumed outside
    // the app) and a session of another directory are never this chat's.
    addSession(db, 'ses_old', '/work/demo', BASE - 60_000)
    addMessage(db, 'ses_old', BASE - 50_000, completed(1, 170_000, 0, BASE - 49_000))
    addSession(db, 'ses_other', '/work/other', BASE + 30_000)
    addMessage(db, 'ses_other', BASE + 31_000, completed(1, 90_000, 0, BASE + 32_000))
    // The first prompt arrives two minutes after the launch.
    addSession(db, 'ses_first', '/work/demo', BASE + 120_000)
    addMessage(db, 'ses_first', BASE + 121_000, completed(842, 67_136, 0, BASE + 130_000))
    addSession(db, 'ses_second', '/work/demo', BASE + 200_000)
    addMessage(db, 'ses_second', BASE + 201_000, completed(1, 1000, 0, BASE + 202_000))

    const usage = service(root, [project('p1', '/work/demo')], [chat('c1', 'p1')], {
      c1: launch('/work/demo', BASE),
    })
    expect(usage.usage()).toEqual({ c1: 67_978 })
  })

  it('gives each chat its own session and follows new turns', () => {
    const root = tempRoot()
    const db = openCodeDb(root)
    addSession(db, 'ses_a', '/work/demo', BASE + 5_000)
    addMessage(db, 'ses_a', BASE + 6_000, completed(1, 100_000, 0, BASE + 7_000))
    const chats = [chat('c1', 'p1')]
    const launches: Record<string, AgentLaunch> = { c1: launch('/work/demo', BASE) }
    const usage = service(root, [project('p1', '/work/demo')], chats, launches)
    expect(usage.usage()).toEqual({ c1: 100_001 })

    // A second chat starts later; the claimed session is not up for grabs, so it
    // waits for its own session and then gets that one.
    chats.push(chat('c2', 'p1'))
    launches.c2 = launch('/work/demo', BASE + 60_000)
    expect(usage.usage()).toEqual({ c1: 100_001 })
    addSession(db, 'ses_b', '/work/demo', BASE + 90_000)
    addMessage(db, 'ses_b', BASE + 91_000, completed(2, 50_000, 0, BASE + 92_000))
    addMessage(db, 'ses_a', BASE + 95_000, completed(3, 181_000, 0, BASE + 96_000))
    expect(usage.usage()).toEqual({ c1: 181_003, c2: 50_002 })
  })

  it('keeps two chats unclaimed in one directory silent, even after one closes', () => {
    const root = tempRoot()
    const db = openCodeDb(root)
    const chats = [chat('c1', 'p1'), chat('c2', 'p1')]
    const launches: Record<string, AgentLaunch> = {
      c1: launch('/work/demo', BASE),
      c2: launch('/work/demo', BASE + 10_000),
    }
    // c2 sends its first prompt before c1: by order alone c1 would take it.
    addSession(db, 'ses_c2', '/work/demo', BASE + 20_000)
    addMessage(db, 'ses_c2', BASE + 21_000, completed(1, 140_000, 0, BASE + 22_000))
    const usage = service(root, [project('p1', '/work/demo')], chats, launches)
    expect(usage.usage()).toEqual({})

    addSession(db, 'ses_c1', '/work/demo', BASE + 40_000)
    addMessage(db, 'ses_c1', BASE + 41_000, completed(1, 30_000, 0, BASE + 42_000))
    expect(usage.usage()).toEqual({})

    // c2 closes; c1 would now claim c2's earlier session, so it stays silent.
    chats.splice(1, 1)
    expect(usage.usage()).toEqual({})
  })

  it('shows nothing without the database or for a session without a completed turn', () => {
    const root = tempRoot()
    const chats = [chat('c1', 'p1')]
    const launches = { c1: launch('/work/demo', BASE) }
    expect(service(root, [project('p1', '/work/demo')], chats, launches).usage()).toEqual({})

    const db = openCodeDb(root)
    addSession(db, 'ses_a', '/work/demo', BASE + 5_000)
    addMessage(db, 'ses_a', BASE + 6_000, inProgress(BASE + 6_000))
    expect(service(root, [project('p1', '/work/demo')], chats, launches).usage()).toEqual({})
  })

  it('matches the directory with the Codex path comparison and skips SSH projects', () => {
    const root = tempRoot()
    const db = openCodeDb(root)
    addSession(db, 'ses_a', 'F:/Projects/Demo', BASE + 5_000)
    addMessage(db, 'ses_a', BASE + 6_000, completed(1, 70_000, 0, BASE + 7_000))
    const usage = service(
      root,
      [project('p1', 'F:\\projects\\demo'), project('p2', 'ssh://host/work/demo')],
      [chat('c1', 'p1'), chat('c2', 'p2')],
      {
        c1: launch('F:\\projects\\demo', BASE),
        c2: launch('ssh://host/work/demo', BASE),
      },
    )
    expect(usage.usage()).toEqual({ c1: 70_001 })
  })

  it('never hands a closed chat session to a chat launched just after it started', () => {
    const root = tempRoot()
    const db = openCodeDb(root)
    addSession(db, 'ses_a', '/work/demo', BASE + 3_000)
    addMessage(db, 'ses_a', BASE + 3_100, completed(1, 150_000, 0, BASE + 4_000))
    const chats = [chat('c1', 'p1')]
    const launches: Record<string, AgentLaunch> = { c1: launch('/work/demo', BASE) }
    const usage = service(root, [project('p1', '/work/demo')], chats, launches)
    expect(usage.usage()).toEqual({ c1: 150_001 })

    // c2 starts 1 s after c1's session did, inside the start tolerance, and has
    // not prompted yet. Closing c1 frees nothing: ses_a is still c1's session.
    chats.push(chat('c2', 'p1'))
    launches.c2 = launch('/work/demo', BASE + 4_000)
    expect(usage.usage()).toEqual({ c1: 150_001 })
    chats.splice(0, 1)
    expect(usage.usage()).toEqual({})
    addSession(db, 'ses_b', '/work/demo', BASE + 60_000)
    addMessage(db, 'ses_b', BASE + 61_000, completed(2, 20_000, 0, BASE + 62_000))
    expect(usage.usage()).toEqual({ c2: 20_002 })
  })

  it('contests chats unclaimed together while the database cannot be read', () => {
    const root = tempRoot()
    const chats = [chat('c1', 'p1'), chat('c2', 'p1')]
    const launches: Record<string, AgentLaunch> = {
      c1: launch('/work/demo', BASE),
      c2: launch('/work/demo', BASE + 10_000),
    }
    const usage = service(root, [project('p1', '/work/demo')], chats, launches)
    expect(usage.usage()).toEqual({})

    // c2 prompts and closes before the database becomes readable; c1 must not
    // inherit its session.
    chats.splice(1, 1)
    const db = openCodeDb(root)
    addSession(db, 'ses_c2', '/work/demo', BASE + 20_000)
    addMessage(db, 'ses_c2', BASE + 21_000, completed(1, 140_000, 0, BASE + 22_000))
    expect(usage.usage()).toEqual({})
  })
})
