import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentProfilePut } from '../../../shared/ipc-contract'
import {
  AGENT_PROMPT_PLACEHOLDER,
  projectAgentProfilesKey,
  projectHandoffDirKey,
  projectShellKey,
} from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'
import { openDatabase } from '../../db/connection'
import { runMigrations } from '../../db/migrations'
import { AppStateService } from '../app-state-service'
import { type AgentProfilesProjectLookup, AgentProfilesService } from './agent-profiles-service'

// :memory: covers validation and key isolation. It does not exercise WAL.

const openDatabases: Array<{ close(): void }> = []

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
})

function createHarness(): {
  service: AgentProfilesService
  state: AppStateService
  db: Database.Database
  projects: AgentProfilesProjectLookup
} {
  const db = openDatabase(':memory:')
  openDatabases.push(db)
  runMigrations(db)
  const state = new AppStateService({ db })
  const projects: AgentProfilesProjectLookup = {
    get(projectId: string) {
      const row = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as
        | { path: string }
        | undefined
      return row ?? null
    },
  }
  return { service: new AgentProfilesService({ projects, state }), state, db, projects }
}

function insertProject(db: Database.Database, id: string): void {
  db.prepare(
    'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, `project-${id}`, `D:/code/${id}`, null, '2026-01-01T00:00:00Z')
}

function valid(name: string, executable = name.toLowerCase()): AgentProfilePut {
  return {
    id: null,
    name,
    executable,
    args: ['--flag', AGENT_PROMPT_PLACEHOLDER, 'a b', '"quote"', '$(nope)'],
    isDefault: false,
  }
}

describe('AgentProfilesService', () => {
  it('rejects invalid profiles and a client-minted id without writing', () => {
    const { service, state, db } = createHarness()
    insertProject(db, 'p1')
    const key = projectAgentProfilesKey('p1')
    const invalid: AgentProfilePut[] = [
      { ...valid('Claude'), name: '   ' },
      { ...valid('Claude'), name: '' },
      { ...valid('Claude'), executable: '\t' },
      { ...valid('Claude'), executable: '' },
      { ...valid('Claude'), args: [] },
      { ...valid('Claude'), args: ['--flag'] },
      { ...valid('Claude'), args: [AGENT_PROMPT_PLACEHOLDER, AGENT_PROMPT_PLACEHOLDER] },
      { ...valid('Claude'), args: [`${AGENT_PROMPT_PLACEHOLDER} extra`] },
      { ...valid('Claude'), args: [` ${AGENT_PROMPT_PLACEHOLDER}`] },
      { ...valid('Claude'), args: ['x{prompt}x'] },
    ]
    for (const input of invalid) {
      try {
        service.put('p1', input)
        expect.unreachable(`validation must reject ${JSON.stringify(input)}`)
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe('validation')
      }
      expect(state.get(key)).toBeNull()
    }

    try {
      service.put('p1', { ...valid('Claude'), id: 'client-minted' })
      expect.unreachable('main mints the id')
    } catch (error) {
      expect((error as AppError).code).toBe('not_found')
    }
    expect(state.get(key)).toBeNull()

    try {
      service.put('missing', valid('Claude'))
      expect.unreachable('unknown project must not write')
    } catch (error) {
      expect((error as AppError).code).toBe('not_found')
    }
    expect(state.get(projectAgentProfilesKey('missing'))).toBeNull()

    const saved = service.put('p1', valid('Claude', '  claude.exe  '))
    const raw = state.get(key)
    expect(raw).not.toBeNull()
    for (const input of invalid) {
      try {
        service.put('p1', input)
        expect.unreachable(`validation must reject ${JSON.stringify(input)}`)
      } catch (error) {
        expect((error as AppError).code).toBe('validation')
      }
      expect(state.get(key)).toBe(raw)
    }
    try {
      service.put('p1', { ...valid('Other'), id: 'client-minted' })
      expect.unreachable('unknown profile must not write')
    } catch (error) {
      expect((error as AppError).code).toBe('not_found')
    }
    try {
      service.delete('p1', 'missing-profile')
      expect.unreachable('missing delete must not write')
    } catch (error) {
      expect((error as AppError).code).toBe('not_found')
    }
    expect(state.get(key)).toBe(raw)
    expect(service.get('p1')).toEqual(saved)
  })

  it('mints a stable id, trims fields, and keeps args literal across a new service', () => {
    const { service, state, db, projects } = createHarness()
    insertProject(db, 'p1')
    expect(service.get('p1')).toEqual({ defaultId: null, profiles: [] })
    expect(state.get(projectAgentProfilesKey('p1'))).toBeNull()

    const created = service.put('p1', {
      ...valid('  Claude  ', '  claude.exe  '),
      isDefault: true,
    })
    const id = created.profiles[0]?.id
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created).toEqual({
      defaultId: id,
      profiles: [
        {
          id,
          name: 'Claude',
          executable: 'claude.exe',
          args: ['--flag', AGENT_PROMPT_PLACEHOLDER, 'a b', '"quote"', '$(nope)'],
        },
      ],
    })
    const stored = JSON.parse(state.get(projectAgentProfilesKey('p1')) ?? 'null') as {
      defaultId: string
      profiles: Array<Record<string, unknown>>
    }
    expect(Object.keys(stored).sort()).toEqual(['defaultId', 'profiles'])
    expect(stored.profiles[0]).toEqual(created.profiles[0])

    const edited = service.put('p1', {
      id: id ?? null,
      name: 'Claude Code',
      executable: 'claude',
      args: [AGENT_PROMPT_PLACEHOLDER],
      isDefault: true,
    })
    expect(edited.profiles).toEqual([
      {
        id,
        name: 'Claude Code',
        executable: 'claude',
        args: [AGENT_PROMPT_PLACEHOLDER],
      },
    ])

    const restarted = new AgentProfilesService({ projects, state })
    expect(restarted.get('p1')).toEqual(edited)
  })

  it('keeps each project document isolated', () => {
    const { service, state, db } = createHarness()
    insertProject(db, 'p1')
    insertProject(db, 'p2')
    service.put('p1', { ...valid('Alpha', 'alpha'), isDefault: true })
    service.put('p2', valid('Beta', 'beta'))
    expect(service.get('p1').profiles.map((profile) => profile.name)).toEqual(['Alpha'])
    expect(service.get('p2').profiles.map((profile) => profile.name)).toEqual(['Beta'])
    expect(service.get('p1').defaultId).not.toBeNull()
    expect(service.get('p2').defaultId).toBeNull()
    const raw1 = state.get(projectAgentProfilesKey('p1')) ?? ''
    const raw2 = state.get(projectAgentProfilesKey('p2')) ?? ''
    expect(raw1).not.toContain('Beta')
    expect(raw2).not.toContain('Alpha')
  })

  it('clears defaultId when the default profile is unset or deleted, without promoting another', () => {
    const { service, db } = createHarness()
    insertProject(db, 'p1')
    const first = service.put('p1', { ...valid('Alpha', 'alpha'), isDefault: true })
    const alphaId = first.profiles[0]?.id ?? ''
    const second = service.put('p1', valid('Beta', 'beta'))
    expect(second.defaultId).toBe(alphaId)
    const betaId = second.profiles[1]?.id ?? ''
    const kept = service.put('p1', { ...valid('Beta renamed', 'beta'), id: betaId })
    expect(kept.defaultId).toBe(alphaId)
    expect(kept.profiles.map((profile) => profile.name)).toEqual(['Alpha', 'Beta renamed'])

    const moved = service.put('p1', {
      id: betaId,
      name: 'Beta',
      executable: 'beta',
      args: ['--flag', AGENT_PROMPT_PLACEHOLDER, 'a b', '"quote"', '$(nope)'],
      isDefault: true,
    })
    expect(moved.defaultId).toBe(betaId)

    const cleared = service.put('p1', {
      id: betaId,
      name: 'Beta',
      executable: 'beta',
      args: ['--flag', AGENT_PROMPT_PLACEHOLDER, 'a b', '"quote"', '$(nope)'],
      isDefault: false,
    })
    expect(cleared.defaultId).toBeNull()

    const reset = service.put('p1', {
      id: alphaId,
      name: 'Alpha',
      executable: 'alpha',
      args: [AGENT_PROMPT_PLACEHOLDER],
      isDefault: true,
    })
    expect(reset.defaultId).toBe(alphaId)
    const after = service.delete('p1', alphaId)
    expect(after.defaultId).toBeNull()
    expect(after.profiles.map((profile) => profile.name)).toEqual(['Beta'])
  })

  it('removes only the deleted project document and does not write on read', () => {
    const { service, state, db } = createHarness()
    insertProject(db, 'p1')
    insertProject(db, 'p2')
    service.put('p1', { ...valid('Alpha', 'alpha'), isDefault: true })
    service.put('p2', valid('Beta', 'beta'))
    state.set(projectHandoffDirKey('p1'), '.agents/handoffs')
    state.set(projectShellKey('p1'), 'pwsh')
    state.set(
      projectAgentProfilesKey('p1'),
      JSON.stringify({
        defaultId: 'gone',
        profiles: [
          {
            id: 'a',
            name: 'Alpha',
            executable: 'alpha',
            args: [AGENT_PROMPT_PLACEHOLDER],
          },
        ],
      }),
    )
    expect(service.get('p1').defaultId).toBeNull()
    expect(state.get(projectAgentProfilesKey('p1'))).toContain('gone')

    state.set(projectAgentProfilesKey('p1'), '{')
    expect(service.get('p1')).toEqual({ defaultId: null, profiles: [] })
    expect(state.get(projectAgentProfilesKey('p1'))).toBe('{')

    db.prepare('DELETE FROM projects WHERE id = ?').run('p1')
    service.cleanupProject('p1')
    service.cleanupProject('p1')
    expect(state.get(projectAgentProfilesKey('p1'))).toBeNull()
    expect(state.get(projectHandoffDirKey('p1'))).toBe('.agents/handoffs')
    expect(state.get(projectShellKey('p1'))).toBe('pwsh')
    expect(service.get('p2').profiles.map((profile) => profile.name)).toEqual(['Beta'])
    expect(() => service.get('p1')).toThrow(AppError)
  })
})
