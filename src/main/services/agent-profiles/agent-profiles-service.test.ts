import { serializeAgentCommand } from '@shared/agent-command'
import type { AgentProfilePut } from '@shared/ipc-contract'
import {
  AGENT_PROFILES_LIBRARY_KEY,
  projectAgentProfilesKey,
  projectAgentSelectionKey,
  projectHandoffDirKey,
} from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../db/connection'
import { runMigrations } from '../../db/migrations'
import { projectPathIdentity } from '../../db/project-identity'
import { AppStateService } from '../app-state-service'
import { AgentProfilesService } from './agent-profiles-service'

const openDatabases: Database.Database[] = []
afterEach(() => {
  for (const db of openDatabases.splice(0)) db.close()
})

function harness() {
  const db = openDatabase(':memory:')
  openDatabases.push(db)
  runMigrations(db)
  const state = new AppStateService({ db })
  for (const id of ['p1', 'p2', 'empty'])
    db.prepare(
      'INSERT INTO projects (id, name, path, path_identity, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(
      id,
      `Project ${id}`,
      `D:/code/${id}`,
      projectPathIdentity(`D:/code/${id}`, process.platform),
      '2026-01-01',
    )
  const projects = {
    get: (id: string) =>
      (db.prepare('SELECT name, path FROM projects WHERE id = ?').get(id) as
        | { name: string; path: string }
        | undefined) ?? null,
  }
  return { db, state, projects, service: new AgentProfilesService({ state, projects }) }
}

const exact = {
  executable: 'C:\\Agent tools\\agent.exe',
  args: [
    '--model',
    'my model',
    '',
    '"quotes"',
    "it's",
    'C:\\folder\\',
    '$(nope)',
    '|;&<>',
    '{prompt}',
  ],
}
function valid(name = 'Agent'): AgentProfilePut {
  return { id: null, name, command: serializeAgentCommand(exact) }
}

describe('global agent profiles and project opt-in', () => {
  it('persists, copies and clears exact interactive arguments, including an empty override', () => {
    const { service, state, projects } = harness()
    const interactiveArgs = ['C:\\Agent tools\\cli.js', '', 'my model', 'line\r\nbreak']
    const agent = service.put({ ...valid(), interactiveArgs }).profiles[0]
    interactiveArgs.push('must not mutate saved arguments')
    const restarted = new AgentProfilesService({ state, projects })
    expect(restarted.libraryGet().profiles[0].interactiveArgs).toEqual(interactiveArgs.slice(0, -1))
    const copied = restarted.put({ ...valid('Copy'), interactiveArgs: agent.interactiveArgs })
      .profiles[1]
    expect(copied.id).not.toBe(agent.id)
    expect(copied.interactiveArgs).toEqual(agent.interactiveArgs)
    expect(restarted.selectionGet('p1').selectedIds).toEqual([])
    const empty = restarted.put({ ...valid(), id: agent.id, interactiveArgs: [] }).profiles[0]
    expect(empty.interactiveArgs).toEqual([])
    expect(
      new AgentProfilesService({ state, projects }).libraryGet().profiles[0].interactiveArgs,
    ).toEqual([])
    restarted.put({ ...valid(), id: agent.id })
    expect(restarted.libraryGet().profiles[0]).not.toHaveProperty('interactiveArgs')
  })

  it.each(
    [
      null,
      'args',
      {},
      [42],
      new Array<string>(1),
      ['\u0000'],
      ['{prompt}'],
      ['prefix{prompt}suffix'],
    ].map((interactiveArgs) => ({ interactiveArgs })),
  )(
    'rejects an invalid interactive override %j at write and stored-document boundaries',
    ({ interactiveArgs }) => {
      const { service, state } = harness()
      const agent = service.put(valid()).profiles[0]
      const before = state.get(AGENT_PROFILES_LIBRARY_KEY)
      expect(() => service.put({ ...valid(), interactiveArgs } as AgentProfilePut)).toThrow(
        AppError,
      )
      expect(state.get(AGENT_PROFILES_LIBRARY_KEY)).toBe(before)
      const corrupted = JSON.stringify({ version: 1, profiles: [{ ...agent, interactiveArgs }] })
      state.set(AGENT_PROFILES_LIBRARY_KEY, corrupted)
      expect(() => service.libraryGet()).toThrow(AppError)
      expect(state.get(AGENT_PROFILES_LIBRARY_KEY)).toBe(corrupted)
    },
  )

  it('starts empty, creates exact argv globally and persists choices across restart', () => {
    const { service, state, projects } = harness()
    expect(service.libraryGet()).toEqual({ version: 1, profiles: [] })
    expect(service.get('p1')).toEqual({ defaultId: null, profiles: [] })
    const created = service.put(valid('  Agent  ')).profiles[0]
    expect(created).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Agent',
      ...exact,
    })
    expect(service.get('p1').profiles).toEqual([])
    expect(service.selectionGet('p2')).toEqual({ version: 1, selectedIds: [], defaultId: null })
    expect(state.get(projectAgentProfilesKey('p1'))).toBeNull()
    service.selectionSet('p1', { selectedIds: [created.id], defaultId: null })
    expect(service.get('p1')).toEqual({ defaultId: null, profiles: [created] })
    const restarted = new AgentProfilesService({ state, projects })
    expect(restarted.libraryGet()).toEqual(service.libraryGet())
    expect(restarted.selectionGet('p1')).toEqual(service.selectionGet('p1'))
    expect(restarted.get('p2').profiles).toEqual([])
  })

  it('keeps library order, optional defaults and independent choices; edit keeps id and copy adds no selection', () => {
    const { service } = harness()
    const alpha = service.put(valid('Same')).profiles[0]
    const beta = service.put(valid('Same')).profiles[1]
    service.selectionSet('p1', { selectedIds: [beta.id, alpha.id], defaultId: beta.id })
    service.selectionSet('p2', { selectedIds: [alpha.id], defaultId: null })
    service.put({ id: alpha.id, name: 'Edited', command: 'changed "{prompt}"' })
    expect(service.get('p1').profiles.map((p) => p.name)).toEqual(['Edited', 'Same'])
    expect(service.get('p2').profiles[0].executable).toBe('changed')
    service.put(valid('Copy'))
    expect(service.selectionGet('p1').selectedIds).toEqual([beta.id, alpha.id])
    service.selectionSet('p1', { selectedIds: [alpha.id], defaultId: null })
    expect(service.get('p1').defaultId).toBeNull()
    expect(service.get('p2').defaultId).toBeNull()
  })

  it('rejects invalid profiles and stale edits without changing the library', () => {
    const { service, state } = harness()
    service.put(valid())
    const before = state.get(AGENT_PROFILES_LIBRARY_KEY)
    for (const input of [
      { ...valid(), name: '  ' },
      { ...valid(), command: '' },
      { ...valid(), command: 'agent "unclosed' },
      { ...valid(), command: 'agent && echo' },
      { ...valid(), command: 'agent\n"{prompt}"' },
      { ...valid(), command: 'agent "\u0000" "{prompt}"' },
      { ...valid(), command: 'agent' },
      { ...valid(), command: 'agent pre{prompt}' },
      { ...valid(), command: 'agent "{prompt}" "{prompt}"' },
      { ...valid(), id: '' },
      { ...valid(), command: 42 },
    ])
      expect(() => service.put(input as AgentProfilePut)).toThrow(AppError)
    expect(() => service.put({ ...valid(), id: 'missing' })).toThrow(/not found/)
    expect(() => service.delete('missing')).toThrow(/not found/)
    expect(state.get(AGENT_PROFILES_LIBRARY_KEY)).toBe(before)
  })

  it('rejects invalid selection atomically and blocks deletion with project names until deselected', () => {
    const { service, state } = harness()
    const agent = service.put(valid()).profiles[0]
    service.selectionSet('p1', { selectedIds: [agent.id], defaultId: agent.id })
    const before = state.get(projectAgentSelectionKey('p1'))
    for (const input of [
      { selectedIds: [], defaultId: agent.id },
      { selectedIds: ['missing'], defaultId: null },
      { selectedIds: [agent.id, agent.id], defaultId: null },
      { selectedIds: [42], defaultId: null },
      { selectedIds: [], defaultId: undefined },
    ])
      expect(() => service.selectionSet('p1', input as never)).toThrow(AppError)
    expect(state.get(projectAgentSelectionKey('p1'))).toBe(before)
    expect(() => service.selectionSet('missing', { selectedIds: [], defaultId: null })).toThrow(
      /Project not found/,
    )
    expect(() => service.delete(agent.id)).toThrow(/Project p1/)
    expect(service.libraryGet().profiles).toEqual([agent])
    service.selectionSet('p1', { selectedIds: [], defaultId: null })
    expect(service.delete(agent.id).profiles).toEqual([])
  })

  it('cleanup deletes only assignment and re-adding a folder requires opt-in', () => {
    const { service, state, db } = harness()
    const agent = service.put(valid()).profiles[0]
    service.selectionSet('p1', { selectedIds: [agent.id], defaultId: agent.id })
    state.set(projectHandoffDirKey('p1'), '.agents/handoffs')
    db.prepare('DELETE FROM projects WHERE id = ?').run('p1')
    service.cleanupProject('p1')
    service.cleanupProject('p1')
    expect(state.get(projectAgentSelectionKey('p1'))).toBeNull()
    expect(state.get(projectHandoffDirKey('p1'))).toBe('.agents/handoffs')
    expect(service.libraryGet().profiles).toEqual([agent])
    db.prepare(
      'INSERT INTO projects (id, name, path, path_identity, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(
      'new',
      'Re-added',
      'D:/code/p1',
      projectPathIdentity('D:/code/p1', process.platform),
      '2026-01-01',
    )
    expect(service.get('new').profiles).toEqual([])
  })
})

describe('strict transactional legacy migration', () => {
  it('preserves interactive argv through migration and rejects invalid legacy overrides without writes', () => {
    const { service, state } = harness()
    const legacy = {
      id: 'legacy',
      name: 'Legacy',
      ...exact,
      interactiveArgs: ['--model', 'my model', ''],
    }
    state.set(
      projectAgentProfilesKey('p1'),
      JSON.stringify({ defaultId: legacy.id, profiles: [legacy] }),
    )
    expect(service.libraryGet().profiles[0].interactiveArgs).toEqual(legacy.interactiveArgs)
    const bad = harness()
    const source = JSON.stringify({
      defaultId: null,
      profiles: [{ ...legacy, interactiveArgs: ['{prompt}'] }],
    })
    bad.state.set(projectAgentProfilesKey('p1'), source)
    expect(() => bad.service.libraryGet()).toThrow(/Original data has been preserved/)
    expect(bad.state.get(projectAgentProfilesKey('p1'))).toBe(source)
    expect(bad.state.get(AGENT_PROFILES_LIBRARY_KEY)).toBeNull()
  })

  it('preserves legacy definitions when a project is removed before the first library read', () => {
    const { service, state, db } = harness()
    const legacy = { id: 'legacy', name: 'Legacy', ...exact }
    state.set(
      projectAgentProfilesKey('p1'),
      JSON.stringify({ defaultId: legacy.id, profiles: [legacy] }),
    )
    db.prepare('DELETE FROM projects WHERE id = ?').run('p1')
    service.cleanupProject('p1')
    expect(service.libraryGet().profiles).toEqual([{ ...legacy, originProjectName: 'p1' }])
    expect(state.get(projectAgentProfilesKey('p1'))).toBeNull()
    expect(state.get(projectAgentSelectionKey('p1'))).toBeNull()
  })

  it('preserves malformed legacy sources when cleanup cannot migrate them', () => {
    const { service, state } = harness()
    state.set(projectAgentProfilesKey('p1'), '{')
    expect(() => service.cleanupProject('p1')).toThrow(/p1.*Original data has been preserved/)
    expect(state.get(projectAgentProfilesKey('p1'))).toBe('{')
    expect(state.get(AGENT_PROFILES_LIBRARY_KEY)).toBeNull()
  })

  it('renames a migrated profile while preserving CR/LF and literal backtick arguments', () => {
    const { service, state } = harness()
    const legacy = {
      id: 'legacy',
      name: 'Legacy',
      ...exact,
      args: ['line\r\nbreak', '`n', '{prompt}'],
    }
    state.set(
      projectAgentProfilesKey('p1'),
      JSON.stringify({ defaultId: legacy.id, profiles: [legacy] }),
    )
    const migrated = service.libraryGet().profiles[0]
    service.put({ id: migrated.id, name: 'Renamed', command: serializeAgentCommand(migrated) })
    expect(service.get('p1').profiles[0]).toEqual({ ...migrated, name: 'Renamed' })
  })

  it('preserves independent definitions, order, exact argv, extra fields and colliding id defaults, then stays idempotent', () => {
    const { service, state, projects } = harness()
    const legacy = { id: 'same-id', name: 'Same', ...exact, extraLaunchField: 'keep' }
    state.set(
      projectAgentProfilesKey('p1'),
      JSON.stringify({ defaultId: legacy.id, profiles: [legacy] }),
    )
    state.set(
      projectAgentProfilesKey('p2'),
      JSON.stringify({ defaultId: null, profiles: [legacy] }),
    )
    state.set(projectAgentProfilesKey('empty'), JSON.stringify({ defaultId: null, profiles: [] }))
    const library = service.libraryGet()
    expect(library.profiles).toHaveLength(2)
    expect(library.profiles[0]).toEqual({ ...legacy, originProjectName: 'Project p1' })
    expect(library.profiles[1]).toEqual({
      ...legacy,
      id: expect.any(String),
      originProjectName: 'Project p2',
    })
    expect(library.profiles[1].id).not.toBe(legacy.id)
    expect(service.get('p1').defaultId).toBe(legacy.id)
    expect(service.get('p2').defaultId).toBeNull()
    expect(service.selectionGet('p2').selectedIds).toEqual([library.profiles[1].id])
    expect(service.get('empty')).toEqual({ defaultId: null, profiles: [] })
    expect(state.listPrefix('project.agentProfiles:')).toEqual([])
    service.selectionSet('p1', { selectedIds: [], defaultId: null })
    service.delete(legacy.id)
    const restarted = new AgentProfilesService({ state, projects })
    expect(restarted.libraryGet().profiles).toEqual([library.profiles[1]])
    expect(restarted.get('p1').profiles).toEqual([])
  })

  it.each([
    '{',
    JSON.stringify({ defaultId: 'missing', profiles: [] }),
    JSON.stringify({
      defaultId: null,
      profiles: [{ id: 'a', name: 'A', executable: 'a', args: [] }],
    }),
  ])('preserves all sources when one document is malformed: %s', (bad) => {
    const { service, state } = harness()
    const good = JSON.stringify({ defaultId: 'a', profiles: [{ id: 'a', name: 'A', ...exact }] })
    state.set(projectAgentProfilesKey('p1'), good)
    state.set(projectAgentProfilesKey('p2'), bad)
    expect(() => service.libraryGet()).toThrow(/p2.*Original data has been preserved/)
    expect(state.get(AGENT_PROFILES_LIBRARY_KEY)).toBeNull()
    expect(state.get(projectAgentSelectionKey('p1'))).toBeNull()
    expect(state.get(projectAgentProfilesKey('p1'))).toBe(good)
    expect(state.get(projectAgentProfilesKey('p2'))).toBe(bad)
  })

  it('rolls back migration when persistence fails midway', () => {
    const { state, projects } = harness()
    const source = JSON.stringify({ defaultId: null, profiles: [{ id: 'a', name: 'A', ...exact }] })
    state.set(projectAgentProfilesKey('p1'), source)
    const failing = new AgentProfilesService({
      projects,
      state: {
        get: (key) => state.get(key),
        delete: (key) => state.delete(key),
        listPrefix: (prefix) => state.listPrefix(prefix),
        transaction: (run) => state.transaction(run),
        set: (key, value) => {
          if (key === projectAgentSelectionKey('p1')) throw new Error('write failed')
          state.set(key, value)
        },
      },
    })
    expect(() => failing.libraryGet()).toThrow(/Failed to read or save/)
    expect(state.get(AGENT_PROFILES_LIBRARY_KEY)).toBeNull()
    expect(state.get(projectAgentProfilesKey('p1'))).toBe(source)
    expect(state.get(projectAgentSelectionKey('p1'))).toBeNull()
  })

  it('distinguishes corrupt library or selection data from empty configuration', () => {
    const { service, state } = harness()
    state.set(AGENT_PROFILES_LIBRARY_KEY, '{')
    expect(() => service.libraryGet()).toThrow(/stored agent library is invalid/)
    expect(state.get(AGENT_PROFILES_LIBRARY_KEY)).toBe('{')
    state.set(AGENT_PROFILES_LIBRARY_KEY, JSON.stringify({ version: 1, profiles: [] }))
    state.set(projectAgentSelectionKey('p1'), '{')
    expect(() => service.get('p1')).toThrow(/stored agent selection.*invalid/)
    expect(state.get(projectAgentSelectionKey('p1'))).toBe('{')
  })
})
