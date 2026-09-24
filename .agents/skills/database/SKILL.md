---
name: database
description: Use when changing NeKode SQLite persistence (ProjectService, TaskService, AppStateService, schema or migrations, transactions, or app_state reads and writes). Do not use for IPC plumbing or renderer state.
---

# Database (SQLite)

Rules for `better-sqlite3` persistence in the main process. Reference:
https://www.sqlite.org/wal.html

## When to use and when not to use

Use for: schema and migration edits, `src/main/db/*`, `src/main/services/*`,
`APP_STATE_KEY` app_state entries, queries, transactions, DB error mapping.
Do not use for channel or validation changes (see `electron-ipc`) or UI state.

## Current schema and layer (verified 2026-09-24)

- `src/main/db/connection.ts`: `openDatabase` sets `journal_mode = WAL`,
  `foreign_keys = ON`, `busy_timeout = 5000`. Keep all three pragmas.
- `src/main/db/migrations.ts`: versioned `MIGRATIONS` queue; each migration
  runs once inside a transaction and is recorded in `schema_migrations`.
  Tables: `projects` (path UNIQUE), `tasks` (FK `project_id` REFERENCES
  projects ON DELETE CASCADE, UNIQUE(project_id, name)), `app_state`
  (key/value).
- Services take `db` (and `fs`) via DI: `ProjectServiceDeps`,
  `TaskServiceDeps`, `AppStateServiceDeps`; `createServices({ dbPath })`
  wires the stack. DB file: `app.getPath('userData')/nekode.db`
  (`src/main/index.ts:69`).
- Errors: domain rules throw `AppError` with `validation`, `not_found`, or
  `conflict`; SQLite failures map through `wrapSqliteError` to
  `AppError('sqlite', 'Database error.')` with the original logged in main
  only (`src/main/services/project-service.ts`).

## Rules

1. Migrations are append-only: add a new `version` entry, never edit an
   applied one (.agents/engineering.md). `runMigrations` stays idempotent.
2. Multi-statement writes run inside `db.transaction(...)`; validate every
   failure-producing input before the first mutation.
3. Keep FK integrity: cascade delete for owned rows, unique constraints for
   business keys, and stale `app_state` reference cleanup
   (`AppStateService.cleanupSelection`).
4. No ORM or extra repository layer above the current services without a
   real requirement (.agents/engineering.md).

## Sequence

1. Schema change: append a migration with the next version number, update
   affected services, and keep the migration runnable on both empty and
   populated databases.
2. Tests use DI: `:memory:` databases for service and migration logic, a
   temp-dir file database when WAL or file semantics matter (pattern:
   `tempDbPath` in `src/main/db/db.test.ts`). State explicitly that
   `:memory:` does not exercise WAL.
3. Cover: migration idempotence, cascade delete, unique violations mapped to
   `conflict`, validation errors, stale-selection cleanup.

## Checkpoints and verification

- Run `pnpm run test` (the node project includes `src/main/**/*.test.ts`),
  `pnpm run lint`, `pnpm run typecheck`.
- Any destructive operation on a real `nekode.db` (drop, rewrite, manual
  migration of user data) requires separate user authorization with an exact
  target (.agents/safety.md). On Windows `userData` ignores `%APPDATA%`
  redirection (.agents/lessons/items/electron-userdata-not-appdata.md).
