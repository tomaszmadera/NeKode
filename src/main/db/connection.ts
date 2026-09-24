import Database from 'better-sqlite3'

// Opens the SQLite connection with the pragmas the spec relies on:
// WAL journal mode (spec Data/API) and FK enforcement (tasks cascade delete).
export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return db
}
