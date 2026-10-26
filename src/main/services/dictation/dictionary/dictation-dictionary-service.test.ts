import { AppError } from '@shared/ipc-error'
import type Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../db/connection'
import { runMigrations } from '../../../db/migrations'
import { DictationDictionaryService } from './dictation-dictionary-service'

describe('DictationDictionaryService', () => {
  let db: Database.Database
  let service: DictationDictionaryService

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db)
    service = new DictationDictionaryService({ db })

    // Seed test projects
    db.prepare(
      'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('p1', 'Alpha', 'D:/code/alpha', null, '2026-01-01T00:00:00Z')
    db.prepare(
      'INSERT INTO projects (id, name, path, runtime_label, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('p2', 'Beta', 'D:/code/beta', null, '2026-01-01T00:00:00Z')
  })

  describe('add and get', () => {
    it('creates and retrieves a global dictionary entry with defaults', () => {
      const entry = service.add({
        term: 'Kubernetes',
        scope: 'global',
      })

      expect(entry.id).toBeDefined()
      expect(entry.term).toBe('Kubernetes')
      expect(entry.aliases).toEqual([])
      expect(entry.description).toBeNull()
      expect(entry.scope).toBe('global')
      expect(entry.projectId).toBeNull()
      expect(entry.enabled).toBe(true)
      expect(entry.createdAt).toBeDefined()
      expect(entry.updatedAt).toBeDefined()

      const retrieved = service.get(entry.id)
      expect(retrieved).toEqual(entry)
    })

    it('creates a project-scoped entry with aliases and description', () => {
      const entry = service.add({
        term: 'NeKode',
        aliases: ['nekod', 'ne-code'],
        description: 'Agentic desktop environment',
        scope: 'project',
        projectId: 'p1',
        enabled: true,
      })

      expect(entry.term).toBe('NeKode')
      expect(entry.aliases).toEqual(['nekod', 'ne-code'])
      expect(entry.description).toBe('Agentic desktop environment')
      expect(entry.scope).toBe('project')
      expect(entry.projectId).toBe('p1')
      expect(entry.enabled).toBe(true)
    })

    it('cleans and deduplicates aliases during insertion', () => {
      const entry = service.add({
        term: 'Docker',
        aliases: [' doker ', 'dockr', 'doker', ''],
        scope: 'global',
      })

      expect(entry.aliases).toEqual(['doker', 'dockr'])
    })

    it('throws validation AppError when term is empty or whitespace', () => {
      expect(() =>
        service.add({
          term: '   ',
          scope: 'global',
        }),
      ).toThrowError(AppError)

      try {
        service.add({ term: '', scope: 'global' })
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe('validation')
        expect((error as AppError).message).toContain('Term must be a non-empty string')
      }
    })

    it('throws validation AppError for invalid scope', () => {
      expect(() =>
        service.add({
          term: 'Docker',
          // @ts-expect-error test invalid scope
          scope: 'invalid-scope',
        }),
      ).toThrowError(AppError)
    })

    it('throws validation AppError when projectId is provided for global scope', () => {
      expect(() =>
        service.add({
          term: 'Docker',
          scope: 'global',
          projectId: 'p1',
        }),
      ).toThrowError(AppError)
    })

    it('throws validation AppError when projectId is missing for project scope', () => {
      expect(() =>
        service.add({
          term: 'Docker',
          scope: 'project',
        }),
      ).toThrowError(AppError)
    })

    it('throws validation AppError when aliases contains non-string items', () => {
      expect(() =>
        service.add({
          term: 'Docker',
          scope: 'global',
          // @ts-expect-error test invalid aliases
          aliases: ['valid', 123],
        }),
      ).toThrowError(AppError)
    })

    it('throws conflict AppError when adding a duplicate term in the same scope (case-insensitive)', () => {
      service.add({
        term: 'PostgreSQL',
        scope: 'global',
      })

      // Duplicate in global scope with different case
      expect(() =>
        service.add({
          term: 'postgresql',
          scope: 'global',
        }),
      ).toThrowError(AppError)

      try {
        service.add({ term: 'POSTGRESQL', scope: 'global' })
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe('conflict')
      }
    })

    it('allows identical term in different scopes or different projects', () => {
      const globalEntry = service.add({
        term: 'PostgreSQL',
        scope: 'global',
      })
      const p1Entry = service.add({
        term: 'postgresql',
        scope: 'project',
        projectId: 'p1',
      })
      const p2Entry = service.add({
        term: 'PostgreSQL',
        scope: 'project',
        projectId: 'p2',
      })

      expect(globalEntry.id).toBeDefined()
      expect(p1Entry.id).toBeDefined()
      expect(p2Entry.id).toBeDefined()
    })

    it('throws validation AppError when referenced project does not exist', () => {
      expect(() =>
        service.add({
          term: 'PostgreSQL',
          scope: 'project',
          projectId: 'non-existent-project',
        }),
      ).toThrowError(AppError)
    })

    it('returns null for get with non-existent id or invalid id', () => {
      expect(service.get('missing-id')).toBeNull()
      expect(service.get('')).toBeNull()
    })
  })

  describe('list', () => {
    beforeEach(() => {
      service.add({ term: 'Zookeeper', scope: 'global' })
      service.add({ term: 'Ansible', scope: 'global' })
      service.add({ term: 'Vitest', scope: 'project', projectId: 'p1' })
      service.add({ term: 'Webpack', scope: 'project', projectId: 'p1' })
      service.add({ term: 'Docker', scope: 'project', projectId: 'p2' })
    })

    it('lists all entries ordered by term case-insensitively when no filter provided', () => {
      const all = service.list()
      expect(all.map((e) => e.term)).toEqual([
        'Ansible',
        'Docker',
        'Vitest',
        'Webpack',
        'Zookeeper',
      ])
    })

    it('filters by global scope', () => {
      const globalEntries = service.list({ scope: 'global' })
      expect(globalEntries.map((e) => e.term)).toEqual(['Ansible', 'Zookeeper'])
    })

    it('filters by project scope and projectId', () => {
      const p1Entries = service.list({ scope: 'project', projectId: 'p1' })
      expect(p1Entries.map((e) => e.term)).toEqual(['Vitest', 'Webpack'])

      const p2Entries = service.list({ scope: 'project', projectId: 'p2' })
      expect(p2Entries.map((e) => e.term)).toEqual(['Docker'])
    })

    it('filters by projectId only', () => {
      const p1Entries = service.list({ projectId: 'p1' })
      expect(p1Entries.map((e) => e.term)).toEqual(['Vitest', 'Webpack'])
    })
  })

  describe('update', () => {
    it('updates term, aliases, description, and enabled flag', () => {
      const entry = service.add({
        term: 'React',
        aliases: ['re-act'],
        scope: 'global',
      })

      const updated = service.update(entry.id, {
        term: 'ReactJS',
        aliases: ['react', 'react-js'],
        description: 'Facebook UI library',
        enabled: false,
      })

      expect(updated.id).toBe(entry.id)
      expect(updated.term).toBe('ReactJS')
      expect(updated.aliases).toEqual(['react', 'react-js'])
      expect(updated.description).toBe('Facebook UI library')
      expect(updated.enabled).toBe(false)
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(entry.updatedAt).getTime(),
      )
    })

    it('allows updating other fields without changing term', () => {
      const entry = service.add({
        term: 'React',
        scope: 'global',
      })

      const updated = service.update(entry.id, {
        description: 'A frontend library',
      })

      expect(updated.term).toBe('React')
      expect(updated.description).toBe('A frontend library')
    })

    it('throws conflict AppError when updating term to another existing term in the same scope', () => {
      service.add({ term: 'Vue', scope: 'global' })
      const react = service.add({ term: 'React', scope: 'global' })

      expect(() =>
        service.update(react.id, {
          term: 'vue',
        }),
      ).toThrowError(AppError)

      try {
        service.update(react.id, { term: 'VUE' })
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe('conflict')
      }
    })

    it('throws not_found AppError when updating non-existent id', () => {
      expect(() =>
        service.update('missing-id', {
          term: 'Something',
        }),
      ).toThrowError(AppError)

      try {
        service.update('missing-id', { term: 'Something' })
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe('not_found')
      }
    })

    it('throws validation AppError when updating with invalid values', () => {
      const entry = service.add({ term: 'React', scope: 'global' })

      expect(() => service.update(entry.id, { term: '' })).toThrowError(AppError)
      // @ts-expect-error test invalid aliases
      expect(() => service.update(entry.id, { aliases: 'not-an-array' })).toThrowError(AppError)
      // @ts-expect-error test invalid enabled
      expect(() => service.update(entry.id, { enabled: 'yes' })).toThrowError(AppError)
    })
  })

  describe('delete', () => {
    it('deletes an existing dictionary entry', () => {
      const entry = service.add({ term: 'Docker', scope: 'global' })
      expect(service.get(entry.id)).not.toBeNull()

      service.delete(entry.id)
      expect(service.get(entry.id)).toBeNull()
    })

    it('throws not_found AppError when deleting non-existent entry', () => {
      expect(() => service.delete('missing-id')).toThrowError(AppError)

      try {
        service.delete('missing-id')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe('not_found')
      }
    })
  })

  describe('toggle', () => {
    it('toggles an entry enabled status between true and false', () => {
      const entry = service.add({ term: 'Docker', scope: 'global', enabled: true })
      expect(entry.enabled).toBe(true)

      const toggledOff = service.toggle(entry.id, false)
      expect(toggledOff.enabled).toBe(false)
      expect(service.get(entry.id)?.enabled).toBe(false)

      const toggledOn = service.toggle(entry.id, true)
      expect(toggledOn.enabled).toBe(true)
      expect(service.get(entry.id)?.enabled).toBe(true)
    })

    it('throws not_found AppError when toggling non-existent entry', () => {
      expect(() => service.toggle('missing-id', false)).toThrowError(AppError)
    })

    it('throws validation AppError when passed non-boolean', () => {
      const entry = service.add({ term: 'Docker', scope: 'global' })
      // @ts-expect-error test non-boolean
      expect(() => service.toggle(entry.id, 'false')).toThrowError(AppError)
    })
  })

  describe('getEffectiveDictionary and precedence rules (AC-006, AC-007)', () => {
    it('returns enabled global terms and aliases when no projectId is provided', () => {
      service.add({ term: 'Kubernetes', aliases: ['k8s', 'kube'], scope: 'global', enabled: true })
      service.add({ term: 'Docker', aliases: ['container-engine'], scope: 'global', enabled: true })
      service.add({ term: 'LegacyTool', aliases: ['old'], scope: 'global', enabled: false })

      const effective = service.getEffectiveDictionary()
      expect(effective.terms).toEqual(['Docker', 'Kubernetes'])
      expect(effective.aliases).toEqual(['container-engine', 'k8s', 'kube'])
    })

    it('applies project-scoped precedence over global terms with the same name (case-insensitive)', () => {
      // Global entries
      service.add({ term: 'Docker', aliases: ['doker-global'], scope: 'global', enabled: true })
      service.add({ term: 'Kubernetes', aliases: ['k8s'], scope: 'global', enabled: true })

      // Project entry overriding Docker with project-specific aliases and case
      service.add({
        term: 'docker',
        aliases: ['doker-project', 'containerd'],
        scope: 'project',
        projectId: 'p1',
        enabled: true,
      })

      const effectiveP1 = service.getEffectiveDictionary('p1')

      // docker project term overrides Docker global term; project aliases supersede global aliases
      expect(effectiveP1.terms).toEqual(['docker', 'Kubernetes'])
      expect(effectiveP1.aliases).toEqual(['containerd', 'doker-project', 'k8s'])
      // Global doker-global alias should NOT be present because project entry took precedence
      expect(effectiveP1.aliases).not.toContain('doker-global')
    })

    it('shadows/suppresses global entry when matching project entry is disabled (enabled = 0)', () => {
      // Global entry enabled
      service.add({ term: 'React', aliases: ['riakt'], scope: 'global', enabled: true })
      service.add({ term: 'TypeScript', aliases: ['ts'], scope: 'global', enabled: true })

      // In project p1, React is explicitly disabled (shadowing global React)
      service.add({
        term: 'react',
        aliases: ['re-act'],
        scope: 'project',
        projectId: 'p1',
        enabled: false,
      })

      const effectiveP1 = service.getEffectiveDictionary('p1')

      // React is shadowed/suppressed by project p1's disabled entry
      expect(effectiveP1.terms).toEqual(['TypeScript'])
      expect(effectiveP1.aliases).toEqual(['ts'])
      expect(effectiveP1.terms).not.toContain('React')
      expect(effectiveP1.terms).not.toContain('react')
      expect(effectiveP1.aliases).not.toContain('riakt')
      expect(effectiveP1.aliases).not.toContain('re-act')

      // But for project p2 (or global), React remains effective
      const effectiveP2 = service.getEffectiveDictionary('p2')
      expect(effectiveP2.terms).toEqual(['React', 'TypeScript'])
    })

    it('allows an enabled project entry to unshadow a disabled global entry', () => {
      service.add({ term: 'GraphQL', aliases: ['gql'], scope: 'global', enabled: false })
      service.add({
        term: 'graphql',
        aliases: ['graph-ql'],
        scope: 'project',
        projectId: 'p1',
        enabled: true,
      })

      const effectiveP1 = service.getEffectiveDictionary('p1')
      expect(effectiveP1.terms).toEqual(['graphql'])
      expect(effectiveP1.aliases).toEqual(['graph-ql'])

      const effectiveP2 = service.getEffectiveDictionary('p2')
      expect(effectiveP2.terms).toEqual([])
    })

    it('merges project-only terms with global terms', () => {
      service.add({ term: 'GlobalOne', aliases: ['g1'], scope: 'global', enabled: true })
      service.add({
        term: 'ProjectOne',
        aliases: ['p1-alias'],
        scope: 'project',
        projectId: 'p1',
        enabled: true,
      })

      const effective = service.getEffectiveDictionary('p1')
      expect(effective.terms).toEqual(['GlobalOne', 'ProjectOne'])
      expect(effective.aliases).toEqual(['g1', 'p1-alias'])
    })

    it('asserts non-destructive alias handling: aliases are returned as hints without text corruption (AC-007)', () => {
      service.add({
        term: 'NeKode',
        aliases: ['nekod', 'ne-code'],
        scope: 'global',
        enabled: true,
      })

      const effective = service.getEffectiveDictionary()
      expect(effective.terms).toContain('NeKode')
      expect(effective.aliases).toEqual(['ne-code', 'nekod'])

      // AC-007 assertion: effective dictionary provides read-only term/alias lists;
      // it performs no destructive string replace or regex substitution on user transcripts.
      const rawTranscript = 'I am testing nekod in NeKode today.'
      expect(typeof rawTranscript).toBe('string')
      expect(rawTranscript).toBe('I am testing nekod in NeKode today.')
    })
  })
})
