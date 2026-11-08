import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatInfo } from '@shared/contracts/chats-contract'
import type { ProjectInfo } from '@shared/contracts/projects-contract'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentLaunch } from '../agent-session-registry'
import {
  ContextUsageService,
  readCodexContextTokens,
  readCodexSessionMeta,
  readContextTokens,
  transcriptDirName,
} from './context-usage-service'

// Context usage (spec left-panel Behaviour): the tile's number is the agent's
// own reported context, from Claude Code's last assistant usage or Codex's last
// turn token count. These tests prove the reader takes the NEWEST usage from a
// tail read, grows the window for an old line, keeps each chat on its own
// transcript, and shows nothing when it cannot tell.
const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'nekode-context-'))
  roots.push(root)
  return root
}

const assistant = (input: number, cacheRead: number, cacheCreate: number): string =>
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      usage: {
        input_tokens: input,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreate,
      },
    },
  })

function codexRollout(
  cwd: string,
  startedAt: number,
  lastInput: number,
  previousInput = 1000,
): string {
  const meta = JSON.stringify({
    type: 'session_meta',
    payload: { id: 'session', cwd, timestamp: new Date(startedAt).toISOString() },
  })
  const tokenCount = (input: number): string =>
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: input * 4 },
          last_token_usage: { input_tokens: input, cached_input_tokens: input - 10 },
          model_context_window: 475_000,
        },
      },
    })
  return [meta, tokenCount(previousInput), tokenCount(lastInput)].join('\n')
}

function project(id: string, path: string): ProjectInfo {
  return { id, name: 'Demo', path, runtimeLabel: null }
}

function chat(id: string, projectId: string, agentName?: string): ChatInfo {
  return agentName === undefined
    ? { id, projectId, name: 'n' }
    : { id, projectId, name: 'n', agentName }
}

function launch(agentName: string, projectPath: string, startedAt: number): AgentLaunch {
  return { agentName, sessionId: null, startedAt, projectPath }
}

describe('readContextTokens', () => {
  it('sums input, cache read and cache write of the last assistant message', () => {
    const root = tempRoot()
    const file = join(root, 'session.jsonl')
    writeFileSync(
      file,
      [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
        assistant(2, 1000, 250),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'more' } }),
        assistant(4, 40_000, 600),
      ].join('\n'),
    )
    expect(readContextTokens(file)).toBe(40_604)
  })

  it('grows the tail window when the usage line is older than the first read', () => {
    const root = tempRoot()
    const file = join(root, 'session.jsonl')
    const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(400_000) } })
    writeFileSync(file, [assistant(1, 160_500, 0), filler].join('\n'))
    expect(readContextTokens(file)).toBe(160_501)
  })

  it('returns null for a missing or usage-free transcript', () => {
    const root = tempRoot()
    expect(readContextTokens(join(root, 'absent.jsonl'))).toBeNull()
    const file = join(root, 'empty.jsonl')
    writeFileSync(file, JSON.stringify({ type: 'user', message: { role: 'user' } }))
    expect(readContextTokens(file)).toBeNull()
  })
})

describe('Codex transcripts', () => {
  it('reads the last turn prompt size and the rollout identity', () => {
    const root = tempRoot()
    const startedAt = Date.parse('2026-11-08T12:00:00.000Z')
    const file = join(root, 'rollout-2026-11-08T12-00-00-demo.jsonl')
    writeFileSync(file, codexRollout('F:\\projects\\demo', startedAt, 134_446))
    expect(readCodexContextTokens(file)).toBe(134_446)
    expect(readCodexSessionMeta(file)).toEqual({
      cwd: 'F:\\projects\\demo',
      startedAt,
    })
  })

  it('returns null without a token_count event or session_meta', () => {
    const root = tempRoot()
    const file = join(root, 'rollout-empty.jsonl')
    writeFileSync(file, JSON.stringify({ type: 'event_msg', payload: { type: 'other' } }))
    expect(readCodexContextTokens(file)).toBeNull()
    expect(readCodexSessionMeta(file)).toBeNull()
  })
})

describe('ContextUsageService', () => {
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
    })
  }

  it('reports tokens for a Claude chat of a local project only', () => {
    const root = tempRoot()
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
    const sessionId = '11111111-2222-4333-8444-555555555555'
    const dir = join(root, 'claude', 'projects', transcriptDirName(cwd))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${sessionId}.jsonl`), assistant(3, 64_000, 500))
    const claudeLaunch: AgentLaunch = {
      agentName: 'Claude',
      sessionId,
      startedAt: Date.now(),
      projectPath: cwd,
    }
    const usage = service(
      root,
      [project('p1', cwd), project('p2', 'ssh://host/home/demo')],
      [chat('c1', 'p1', 'Claude'), chat('c2', 'p1', 'Codex'), chat('c4', 'p2', 'Claude')],
      { c1: claudeLaunch, c4: { ...claudeLaunch } },
    ).usage()
    expect(usage).toEqual({ c1: 64_503 })
  })

  it('finds the Claude transcript by session id when the directory slug differs', () => {
    const root = tempRoot()
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
    const sessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const dir = join(root, 'claude', 'projects', 'some-other-slug')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${sessionId}.jsonl`), assistant(10, 159_990, 0))
    const usage = service(root, [project('p1', cwd)], [chat('c1', 'p1', 'Claude')], {
      c1: {
        agentName: 'Claude',
        sessionId,
        startedAt: Date.now(),
        projectPath: cwd,
      },
    }).usage()
    expect(usage).toEqual({ c1: 160_000 })
  })

  it('re-reads a changed Claude transcript and drops the count when it disappears', () => {
    const root = tempRoot()
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
    const sessionId = '99999999-8888-4777-8666-555555555555'
    const dir = join(root, 'claude', 'projects', transcriptDirName(cwd))
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${sessionId}.jsonl`)
    writeFileSync(file, assistant(1, 1000, 0))
    const usage = service(root, [project('p1', cwd)], [chat('c1', 'p1', 'Claude')], {
      c1: { agentName: 'Claude', sessionId, startedAt: Date.now(), projectPath: cwd },
    })

    expect(usage.usage()).toEqual({ c1: 1001 })
    writeFileSync(file, assistant(2, 181_000, 0))
    expect(usage.usage()).toEqual({ c1: 181_002 })
    rmSync(file)
    expect(usage.usage()).toEqual({})
  })

  it('gives each Codex chat its own rollout and never shares one', () => {
    const root = tempRoot()
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
    const day = join(root, 'codex', 'sessions', '2026', '11', '08')
    mkdirSync(day, { recursive: true })
    const firstStart = Date.parse('2026-11-08T12:00:00.000Z')
    const secondStart = firstStart + 10_000
    const firstFile = join(day, 'rollout-2026-11-08T12-00-00-aaaa.jsonl')
    const secondFile = join(day, 'rollout-2026-11-08T12-00-10-bbbb.jsonl')
    writeFileSync(firstFile, codexRollout('F:\\projects\\demo', firstStart, 120_000))
    writeFileSync(secondFile, codexRollout('F:\\projects\\demo', secondStart, 185_000))

    const usage = service(
      root,
      [project('p1', cwd)],
      [chat('c1', 'p1', 'Codex'), chat('c2', 'p1', 'Codex')],
      {
        c1: launch('Codex', 'F:\\projects\\demo', firstStart + 500),
        c2: launch('Codex', 'F:\\projects\\demo', secondStart + 500),
      },
    )
    expect(usage.usage()).toEqual({ c1: 120_000, c2: 185_000 })
  })

  it('ignores rollouts of another project', () => {
    const root = tempRoot()
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
    const day = join(root, 'codex', 'sessions', '2026', '11', '08')
    mkdirSync(day, { recursive: true })
    const startedAt = Date.parse('2026-11-08T12:00:00.000Z')
    writeFileSync(
      join(day, 'rollout-2026-11-08T12-00-00-cccc.jsonl'),
      codexRollout('F:\\projects\\elsewhere', startedAt, 170_000),
    )

    const usage = service(root, [project('p1', cwd)], [chat('c1', 'p1', 'Codex')], {
      c1: launch('Codex', 'F:\\projects\\demo', startedAt + 500),
    })
    expect(usage.usage()).toEqual({})
  })

  it('accepts an older rollout that a resumed Codex session is still writing', () => {
    const root = tempRoot()
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
    const day = join(root, 'codex', 'sessions', '2026', '11', '07')
    mkdirSync(day, { recursive: true })
    const file = join(day, 'rollout-2026-11-07T09-00-00-dddd.jsonl')
    writeFileSync(
      file,
      codexRollout('F:\\projects\\demo', Date.parse('2026-11-07T09:00:00.000Z'), 176_000),
    )
    const startedAt = Date.now()
    const touched = new Date(startedAt - 1000)
    utimesSync(file, touched, touched)
    expect(statSync(file).mtimeMs).toBeGreaterThan(startedAt - 60_000)

    const usage = service(root, [project('p1', cwd)], [chat('c1', 'p1', 'Codex')], {
      c1: launch('Codex', 'F:\\projects\\demo', startedAt),
    })
    expect(usage.usage()).toEqual({ c1: 176_000 })
  })

  it('does not adopt a rollout that started long after the launch', () => {
    const root = tempRoot()
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
    const day = join(root, 'codex', 'sessions', '2026', '11', '08')
    mkdirSync(day, { recursive: true })
    const launchedAt = Date.parse('2026-11-08T12:00:00.000Z')
    writeFileSync(
      join(day, 'rollout-2026-11-08T12-02-00-late.jsonl'),
      codexRollout('F:\\projects\\demo', launchedAt + 120_000, 170_000),
    )

    const usage = service(root, [project('p1', cwd)], [chat('c1', 'p1', 'Codex')], {
      c1: launch('Codex', 'F:\\projects\\demo', launchedAt),
    })
    expect(usage.usage()).toEqual({})
  })

  it('gives a contested rollout to the chat whose start matches, not to poll order', () => {
    const root = tempRoot()
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
    const day = join(root, 'codex', 'sessions', '2026', '11', '08')
    mkdirSync(day, { recursive: true })
    const startedAt = Date.parse('2026-11-08T12:00:00.000Z')
    writeFileSync(
      join(day, 'rollout-2026-11-08T12-00-00-dd.jsonl'),
      codexRollout('F:\\projects\\demo', startedAt, 150_000),
    )

    const usage = service(
      root,
      [project('p1', cwd)],
      [chat('c1', 'p1', 'Codex'), chat('c2', 'p1', 'Codex')],
      {
        c1: launch('Codex', 'F:\\projects\\demo', startedAt + 5_000),
        c2: launch('Codex', 'F:\\projects\\demo', startedAt + 100),
      },
    )
    expect(usage.usage()).toEqual({ c2: 150_000 })
  })

  it('retries a rollout whose session_meta was read while it was being written', () => {
    const root = tempRoot()
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
    const day = join(root, 'codex', 'sessions', '2026', '11', '08')
    mkdirSync(day, { recursive: true })
    const startedAt = Date.now()
    const file = join(day, 'rollout-2026-11-08T12-00-00-ee.jsonl')
    writeFileSync(file, '{"type":"session_meta","payload":{"cwd":"F:\\\\projects\\\\demo","time')
    const usage = service(root, [project('p1', cwd)], [chat('c1', 'p1', 'Codex')], {
      c1: launch('Codex', 'F:\\projects\\demo', startedAt),
    })
    expect(usage.usage()).toEqual({})

    writeFileSync(file, codexRollout('F:\\projects\\demo', startedAt, 151_000))
    expect(usage.usage()).toEqual({ c1: 151_000 })
  })
})
