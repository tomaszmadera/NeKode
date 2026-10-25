import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  CreateDictionaryEntryInput,
  DictationDictionaryEntry,
  UpdateDictionaryEntryInput,
} from '../../../../shared/dictation-contract'
import { AppError } from '../../../../shared/ipc-error'
import { wrapSqliteError } from '../../project-service'

export type { DictationDictionaryEntry }
export type CreateDictionaryEntry = CreateDictionaryEntryInput
export type UpdateDictionaryEntry = UpdateDictionaryEntryInput

export interface DictionaryFilter {
  projectId?: string
  scope?: 'global' | 'project'
}

export interface EffectiveDictionary {
  terms: string[]
  aliases: string[]
}

export interface DictationDictionaryServiceDeps {
  db: Database.Database
}

interface DictionaryRow {
  id: string
  term: string
  aliases: string
  description: string | null
  scope: 'global' | 'project'
  project_id: string | null
  enabled: number
  created_at: string
  updated_at: string
}

function parseAliases(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
  } catch {
    // Treat invalid JSON as empty aliases list
  }
  return []
}

function rowToEntry(row: DictionaryRow): DictationDictionaryEntry {
  return {
    id: row.id,
    term: row.term,
    aliases: parseAliases(row.aliases),
    description: row.description,
    scope: row.scope,
    projectId: row.project_id,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (('code' in error && (error as NodeJS.ErrnoException).code === 'SQLITE_CONSTRAINT_UNIQUE') ||
      error.message.includes('UNIQUE constraint failed'))
  )
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (('code' in error &&
      (error as NodeJS.ErrnoException).code === 'SQLITE_CONSTRAINT_FOREIGNKEY') ||
      error.message.includes('FOREIGN KEY constraint failed'))
  )
}

function isCheckViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (('code' in error && (error as NodeJS.ErrnoException).code === 'SQLITE_CONSTRAINT_CHECK') ||
      error.message.includes('CHECK constraint failed'))
  )
}

export class DictationDictionaryService {
  private readonly db: Database.Database

  constructor(deps: DictationDictionaryServiceDeps) {
    this.db = deps.db
  }

  get(id: string): DictationDictionaryEntry | null {
    if (typeof id !== 'string' || id.trim().length === 0) {
      return null
    }
    const row = this.db.prepare('SELECT * FROM dictation_dictionary WHERE id = ?').get(id) as
      | DictionaryRow
      | undefined
    return row ? rowToEntry(row) : null
  }

  list(filter?: DictionaryFilter): DictationDictionaryEntry[] {
    let query = 'SELECT * FROM dictation_dictionary'
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter?.scope === 'global') {
      conditions.push("scope = 'global'")
    } else if (filter?.scope === 'project') {
      conditions.push("scope = 'project'")
      if (filter.projectId && filter.projectId.trim().length > 0) {
        conditions.push('project_id = ?')
        params.push(filter.projectId.trim())
      }
    } else if (filter?.projectId && filter.projectId.trim().length > 0) {
      conditions.push('project_id = ?')
      params.push(filter.projectId.trim())
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }

    query += ' ORDER BY term COLLATE NOCASE ASC, id ASC'

    try {
      const rows = this.db.prepare(query).all(...params) as DictionaryRow[]
      return rows.map(rowToEntry)
    } catch (error) {
      throw wrapSqliteError(error, 'dictation:dictionary:list')
    }
  }

  getEffectiveDictionary(projectId?: string): EffectiveDictionary {
    try {
      const globalRows = this.db
        .prepare("SELECT * FROM dictation_dictionary WHERE scope = 'global'")
        .all() as DictionaryRow[]

      const normalizedProjectId =
        typeof projectId === 'string' && projectId.trim().length > 0 ? projectId.trim() : null

      const projectRows = normalizedProjectId
        ? (this.db
            .prepare(
              "SELECT * FROM dictation_dictionary WHERE scope = 'project' AND project_id = ?",
            )
            .all(normalizedProjectId) as DictionaryRow[])
        : []

      // Map keyed by lowercased term for case-insensitive precedence
      interface Candidate {
        term: string
        aliases: string[]
        enabled: boolean
      }
      const candidates = new Map<string, Candidate>()

      for (const row of globalRows) {
        const entry = rowToEntry(row)
        candidates.set(entry.term.toLowerCase(), {
          term: entry.term,
          aliases: entry.aliases,
          enabled: entry.enabled,
        })
      }

      for (const row of projectRows) {
        const entry = rowToEntry(row)
        // Project-scoped term overrides global term with the same name (case-insensitive)
        candidates.set(entry.term.toLowerCase(), {
          term: entry.term,
          aliases: entry.aliases,
          enabled: entry.enabled,
        })
      }

      const effectiveTerms: string[] = []
      const effectiveAliasesList: string[] = []
      const aliasSeen = new Set<string>()

      for (const candidate of candidates.values()) {
        if (!candidate.enabled) {
          // Disabled entries or shadowed global entries do not contribute to effective terms
          continue
        }
        effectiveTerms.push(candidate.term)
        for (const alias of candidate.aliases) {
          const lower = alias.toLowerCase()
          if (!aliasSeen.has(lower)) {
            aliasSeen.add(lower)
            effectiveAliasesList.push(alias)
          }
        }
      }

      effectiveTerms.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      effectiveAliasesList.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

      return {
        terms: effectiveTerms,
        aliases: effectiveAliasesList,
      }
    } catch (error) {
      throw wrapSqliteError(error, 'dictation:dictionary:getEffective')
    }
  }

  add(input: CreateDictionaryEntry): DictationDictionaryEntry {
    if (!input || typeof input !== 'object') {
      throw new AppError('validation', 'Input must be an object.', 'dictation:dictionary:add')
    }

    if (typeof input.term !== 'string' || input.term.trim().length === 0) {
      throw new AppError(
        'validation',
        'Term must be a non-empty string.',
        'dictation:dictionary:add',
      )
    }
    const term = input.term.trim()

    if (input.scope !== 'global' && input.scope !== 'project') {
      throw new AppError(
        'validation',
        "Scope must be 'global' or 'project'.",
        'dictation:dictionary:add',
      )
    }

    let projectId: string | null = null
    if (input.scope === 'global') {
      if (input.projectId !== undefined && input.projectId !== null) {
        throw new AppError(
          'validation',
          'Project ID must not be set for global scope.',
          'dictation:dictionary:add',
        )
      }
    } else {
      if (typeof input.projectId !== 'string' || input.projectId.trim().length === 0) {
        throw new AppError(
          'validation',
          'Project ID is required for project scope.',
          'dictation:dictionary:add',
        )
      }
      projectId = input.projectId.trim()
    }

    let aliases: string[] = []
    if (input.aliases !== undefined) {
      if (!Array.isArray(input.aliases) || !input.aliases.every((a) => typeof a === 'string')) {
        throw new AppError(
          'validation',
          'Aliases must be an array of strings.',
          'dictation:dictionary:add',
        )
      }
      aliases = [...new Set(input.aliases.map((a) => a.trim()).filter((a) => a.length > 0))]
    }

    let description: string | null = null
    if (input.description !== undefined && input.description !== null) {
      if (typeof input.description !== 'string') {
        throw new AppError(
          'validation',
          'Description must be a string or null.',
          'dictation:dictionary:add',
        )
      }
      description = input.description.trim() || null
    }

    let enabled = true
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean') {
        throw new AppError('validation', 'Enabled must be a boolean.', 'dictation:dictionary:add')
      }
      enabled = input.enabled
    }

    // Check for existing term in the same scope to raise conflict early
    const existing = this.db
      .prepare(
        `SELECT id FROM dictation_dictionary
         WHERE scope = ?
           AND ((? IS NULL AND project_id IS NULL) OR project_id = ?)
           AND term = ? COLLATE NOCASE`,
      )
      .get(input.scope, projectId, projectId, term)

    if (existing) {
      throw new AppError(
        'conflict',
        `A dictionary entry for '${term}' already exists in this scope.`,
        'dictation:dictionary:add',
      )
    }

    const id = input.id ?? randomUUID()
    const now = new Date().toISOString()

    try {
      this.db
        .prepare(`
          INSERT INTO dictation_dictionary (
            id, term, aliases, description, scope, project_id, enabled, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          term,
          JSON.stringify(aliases),
          description,
          input.scope,
          projectId,
          enabled ? 1 : 0,
          now,
          now,
        )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          'conflict',
          `A dictionary entry for '${term}' already exists in this scope.`,
          'dictation:dictionary:add',
        )
      }
      if (isForeignKeyViolation(error)) {
        throw new AppError(
          'validation',
          `Project '${projectId}' does not exist.`,
          'dictation:dictionary:add',
        )
      }
      if (isCheckViolation(error)) {
        throw new AppError(
          'validation',
          'Database constraint violation.',
          'dictation:dictionary:add',
        )
      }
      throw wrapSqliteError(error, 'dictation:dictionary:add')
    }

    const row = this.db
      .prepare('SELECT * FROM dictation_dictionary WHERE id = ?')
      .get(id) as DictionaryRow
    return rowToEntry(row)
  }

  update(id: string, updates: UpdateDictionaryEntry): DictationDictionaryEntry {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new AppError(
        'validation',
        'Entry ID must be a non-empty string.',
        'dictation:dictionary:update',
      )
    }
    if (!updates || typeof updates !== 'object') {
      throw new AppError('validation', 'Updates must be an object.', 'dictation:dictionary:update')
    }

    const existingRow = this.db
      .prepare('SELECT * FROM dictation_dictionary WHERE id = ?')
      .get(id) as DictionaryRow | undefined

    if (!existingRow) {
      throw new AppError(
        'not_found',
        `Dictionary entry with id '${id}' not found.`,
        'dictation:dictionary:update',
      )
    }

    let newTerm = existingRow.term
    if (updates.term !== undefined) {
      if (typeof updates.term !== 'string' || updates.term.trim().length === 0) {
        throw new AppError(
          'validation',
          'Term must be a non-empty string.',
          'dictation:dictionary:update',
        )
      }
      newTerm = updates.term.trim()

      if (newTerm.toLowerCase() !== existingRow.term.toLowerCase()) {
        const conflict = this.db
          .prepare(
            `SELECT id FROM dictation_dictionary
             WHERE scope = ?
               AND ((? IS NULL AND project_id IS NULL) OR project_id = ?)
               AND term = ? COLLATE NOCASE
               AND id != ?`,
          )
          .get(existingRow.scope, existingRow.project_id, existingRow.project_id, newTerm, id)

        if (conflict) {
          throw new AppError(
            'conflict',
            `A dictionary entry for '${newTerm}' already exists in this scope.`,
            'dictation:dictionary:update',
          )
        }
      }
    }

    let newAliases = existingRow.aliases
    if (updates.aliases !== undefined) {
      if (!Array.isArray(updates.aliases) || !updates.aliases.every((a) => typeof a === 'string')) {
        throw new AppError(
          'validation',
          'Aliases must be an array of strings.',
          'dictation:dictionary:update',
        )
      }
      const cleaned = [...new Set(updates.aliases.map((a) => a.trim()).filter((a) => a.length > 0))]
      newAliases = JSON.stringify(cleaned)
    }

    let newDescription = existingRow.description
    if (updates.description !== undefined) {
      if (updates.description !== null && typeof updates.description !== 'string') {
        throw new AppError(
          'validation',
          'Description must be a string or null.',
          'dictation:dictionary:update',
        )
      }
      newDescription = updates.description !== null ? updates.description.trim() || null : null
    }

    let newEnabled = existingRow.enabled
    if (updates.enabled !== undefined) {
      if (typeof updates.enabled !== 'boolean') {
        throw new AppError(
          'validation',
          'Enabled must be a boolean.',
          'dictation:dictionary:update',
        )
      }
      newEnabled = updates.enabled ? 1 : 0
    }

    const now = new Date().toISOString()

    try {
      this.db
        .prepare(`
          UPDATE dictation_dictionary
          SET term = ?, aliases = ?, description = ?, enabled = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(newTerm, newAliases, newDescription, newEnabled, now, id)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          'conflict',
          `A dictionary entry for '${newTerm}' already exists in this scope.`,
          'dictation:dictionary:update',
        )
      }
      throw wrapSqliteError(error, 'dictation:dictionary:update')
    }

    const updatedRow = this.db
      .prepare('SELECT * FROM dictation_dictionary WHERE id = ?')
      .get(id) as DictionaryRow
    return rowToEntry(updatedRow)
  }

  delete(id: string): void {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new AppError(
        'validation',
        'Entry ID must be a non-empty string.',
        'dictation:dictionary:delete',
      )
    }

    try {
      const result = this.db.prepare('DELETE FROM dictation_dictionary WHERE id = ?').run(id)
      if (result.changes === 0) {
        throw new AppError(
          'not_found',
          `Dictionary entry with id '${id}' not found.`,
          'dictation:dictionary:delete',
        )
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw wrapSqliteError(error, 'dictation:dictionary:delete')
    }
  }

  toggle(id: string, enabled: boolean): DictationDictionaryEntry {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new AppError(
        'validation',
        'Entry ID must be a non-empty string.',
        'dictation:dictionary:toggle',
      )
    }
    if (typeof enabled !== 'boolean') {
      throw new AppError('validation', 'Enabled must be a boolean.', 'dictation:dictionary:toggle')
    }

    const now = new Date().toISOString()
    try {
      const result = this.db
        .prepare('UPDATE dictation_dictionary SET enabled = ?, updated_at = ? WHERE id = ?')
        .run(enabled ? 1 : 0, now, id)

      if (result.changes === 0) {
        throw new AppError(
          'not_found',
          `Dictionary entry with id '${id}' not found.`,
          'dictation:dictionary:toggle',
        )
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw wrapSqliteError(error, 'dictation:dictionary:toggle')
    }

    const updatedRow = this.db
      .prepare('SELECT * FROM dictation_dictionary WHERE id = ?')
      .get(id) as DictionaryRow
    return rowToEntry(updatedRow)
  }
}
