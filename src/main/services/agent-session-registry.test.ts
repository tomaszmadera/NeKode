import { describe, expect, it } from 'vitest'
import {
  AgentSessionRegistry,
  choosesOwnSession,
  profileSessionId,
  withSessionId,
} from './agent-session-registry'

// Claude launch session ids (spec left-panel Behaviour): an exact id per launch
// is what lets the context meter read THIS chat's transcript. A profile that
// already chooses its own session keeps its argv.
describe('AgentSessionRegistry', () => {
  it('issues a fresh id per Claude launch, records every launch, and forgets on removal', () => {
    const registry = new AgentSessionRegistry()
    const first = registry.register('c1', 'Claude', 'F:/projects/demo', 1000)
    const second = registry.register('c2', 'Claude', 'F:/projects/demo', 2000)
    expect(first.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(registry.launch('c1')?.sessionId).toBe(first.sessionId)
    expect(registry.launch('c1')?.projectPath).toBe('F:/projects/demo')
    expect(registry.launch('c1')?.startedAt).toBe(1000)
    const codex = registry.register('c3', 'Codex', 'F:/projects/demo', 3000)
    expect(codex.sessionId).toBeNull()
    expect(registry.launch('c3')?.agentName).toBe('Codex')
    registry.setSessionId('c2', null)
    expect(registry.launch('c2')?.sessionId).toBeNull()
    expect(registry.launch('c2')?.startedAt).toBe(2000)
    registry.setSessionId('c2', 'resumed-id')
    expect(registry.launch('c2')?.sessionId).toBe('resumed-id')
    registry.forget('c1')
    expect(registry.launch('c1')).toBeNull()
  })
})

describe('profileSessionId', () => {
  it('reads the id a resume names, in both forms, and ignores other flags', () => {
    expect(profileSessionId('claude.cmd', ['--resume', 'abc'])).toBe('abc')
    expect(profileSessionId('claude.cmd', ['--resume=abc'])).toBe('abc')
    expect(profileSessionId('claude.cmd', ['-r', 'abc'])).toBe('abc')
    expect(profileSessionId('claude.cmd', ['--session-id', 'xyz'])).toBe('xyz')
    expect(profileSessionId('claude.cmd', ['--session-id=xyz'])).toBe('xyz')
    expect(profileSessionId('claude.cmd', ['--continue'])).toBeNull()
    expect(profileSessionId('claude.cmd', ['-c'])).toBeNull()
    expect(profileSessionId('claude.cmd', ['--model', 'x'])).toBeNull()
  })

  it('reads it only from the agent segment of a Node launch', () => {
    expect(profileSessionId('node', ['-r', 'preload.js', 'cli.js', '--resume', 'abc'])).toBe('abc')
    expect(profileSessionId('node', ['-r', 'preload.js', 'cli.js'])).toBeNull()
  })
})

describe('withSessionId', () => {
  it('places the flag before a positional prompt of a direct CLI', () => {
    expect(withSessionId('claude.cmd', ['--model', 'x', 'prompt'], 'id-1')).toEqual([
      '--session-id',
      'id-1',
      '--model',
      'x',
      'prompt',
    ])
  })

  it('places the flag after the script of a Node launch, never before it', () => {
    expect(withSessionId('node.exe', ['C:/app/cli.js', '-q', 'prompt'], 'id-1')).toEqual([
      'C:/app/cli.js',
      '--session-id',
      'id-1',
      '-q',
      'prompt',
    ])
    expect(withSessionId('node', ['-r', 'preload.js', 'C:/app/cli.js'], 'id-1')).toEqual([
      '-r',
      'preload.js',
      'C:/app/cli.js',
      '--session-id',
      'id-1',
    ])
  })

  it('keeps argv untouched when nothing was registered', () => {
    expect(withSessionId('claude.cmd', ['prompt'], null)).toEqual(['prompt'])
  })

  it('keeps a profile that chooses its own session, in every accepted form', () => {
    for (const args of [
      ['--resume', 'abc'],
      ['--resume=abc'],
      ['-r', 'abc'],
      ['--continue'],
      ['-c'],
      ['--fork-session'],
      ['--session-id=abc'],
    ]) {
      expect(withSessionId('claude.cmd', args, 'id-1')).toEqual(args)
      expect(choosesOwnSession('claude.cmd', args)).toBe(true)
    }
    expect(choosesOwnSession('claude.cmd', ['--model', 'x'])).toBe(false)
  })

  it('does not read a Node option before the script as a session choice', () => {
    expect(choosesOwnSession('node', ['-r', 'preload.js', 'cli.js'])).toBe(false)
    expect(withSessionId('node', ['-r', 'preload.js', 'cli.js'], 'id-1')).toEqual([
      '-r',
      'preload.js',
      'cli.js',
      '--session-id',
      'id-1',
    ])
  })
})
