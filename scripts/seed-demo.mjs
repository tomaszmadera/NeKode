import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'

const markerKey = 'dev.demo.version'

/** Add the demo once, keeping later edits and existing workspace settings. */
export function seedDemo(db, projectRoot) {
  const state = db.prepare('SELECT value FROM app_state WHERE key = ?')
  if (state.get(markerKey)) return false

  const insertProject = db.prepare(
    'INSERT INTO projects (id, name, path, path_identity, runtime_label, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
  )
  const insertChat = db.prepare(
    'INSERT INTO chats (id, project_id, name, created_at, task_ref, agent_name) VALUES (?, ?, ?, ?, NULL, NULL)',
  )
  const insertState = db.prepare(
    'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
  )
  const projects = [
    {
      id: 'demo-atlas',
      name: 'Atlas Web',
      color: '#5AA9FF',
      sessions: ['UI alignment', 'Component review', 'A longer session name to check truncation'],
    },
    {
      id: 'demo-orbit',
      name: 'Orbit API',
      color: '#4ADE80',
      sessions: ['API development', 'Integration tests'],
    },
    { id: 'demo-empty', name: 'Empty Playground', color: '#F59E0B', sessions: [] },
  ]
  const createdAt = new Date().toISOString()

  db.exec('BEGIN IMMEDIATE')
  try {
    // Recheck under the write lock in case another seed finished first.
    if (state.get(markerKey)) {
      db.exec('ROLLBACK')
      return false
    }
    for (const project of projects) {
      const directory = resolve(projectRoot, project.name)
      mkdirSync(directory, { recursive: true })
      const readme = join(directory, 'README.md')
      if (!existsSync(readme)) {
        writeFileSync(readme, `# ${project.name}\n\nLocal demo project for NeKode UI testing.\n`, {
          flag: 'wx',
        })
      }
      const identity = process.platform === 'win32' ? directory.toLowerCase() : directory
      insertProject.run(project.id, project.name, directory, identity, createdAt)
      project.sessions.forEach((name, index) => {
        const shell = process.platform === 'win32' ? 'PS5' : 'sh'
        insertChat.run(`${project.id}-${index + 1}`, project.id, `[${shell}] ${name}`, createdAt)
      })
      insertState.run(`project.color:${project.id}`, project.color)
    }
    if (!state.get('selection.projectId')?.value && !state.get('selection.chatId')?.value) {
      const select = db.prepare(
        'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      select.run('selection.projectId', 'demo-atlas')
      select.run('selection.chatId', 'demo-atlas-1')
    }
    insertState.run('projects.showIcons', '1')
    insertState.run('projects.namesUppercase', '1')
    insertState.run('region.left.width', '320')
    insertState.run(markerKey, '1')
    db.exec('COMMIT')
    return true
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const profile = join(repoRoot, 'tmp', 'dev-user-data')
  const dbPath = join(profile, 'nekode.db')
  const runState = join(repoRoot, 'tmp', 'nekode-run.json')
  if (existsSync(runState)) {
    const { rootPid } = JSON.parse(readFileSync(runState, 'utf8').replace(/^\uFEFF/, ''))
    let active = false
    try {
      process.kill(rootPid, 0)
      active = true
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
    if (active) throw new Error('Stop the dev run with scripts/stop.ps1 before seeding the demo.')
  }
  if (!existsSync(dbPath)) {
    throw new Error(
      'Start scripts/start.ps1 once to initialize the dev profile, then stop it and run demo:seed.',
    )
  }
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    const added = seedDemo(db, join(repoRoot, 'tmp', 'demo-projects'))
    console.log(
      added
        ? 'Demo added: 3 projects and 5 sessions.'
        : 'Demo already initialized; existing data kept.',
    )
    console.log(`Profile: ${profile}`)
  } finally {
    db.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
