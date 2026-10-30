// Stage 2 smoke: a real Electron process discovers Resume sources, binds templates,
// validates candidate fingerprints, prepares prompts with opaque single-use tokens,
// and tests both generic file discovery and the Agent Harness preset.

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(import.meta.dirname, '..')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const projectId = 'p-resume-smoke'

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms)
  })
}

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

function openSocket(url) {
  return new Promise((resolveSocket, rejectSocket) => {
    const socket = new WebSocket(url)
    socket.addEventListener('open', () => resolveSocket(socket))
    socket.addEventListener('error', () => rejectSocket(new Error(`websocket failed: ${url}`)))
  })
}

function cdp(socket) {
  let next = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const waiter = pending.get(message.id)
    if (waiter === undefined) return
    pending.delete(message.id)
    waiter(message)
  })
  return (method, params = {}, timeoutMs = 25000) =>
    new Promise((resolveCall, rejectCall) => {
      next += 1
      const id = next
      const timer = setTimeout(() => {
        pending.delete(id)
        rejectCall(new Error(`CDP timeout: ${method}`))
      }, timeoutMs)
      pending.set(id, (message) => {
        clearTimeout(timer)
        if (message.error !== undefined) {
          rejectCall(new Error(`${method} failed: ${JSON.stringify(message.error)}`))
          return
        }
        resolveCall(message.result)
      })
      socket.send(JSON.stringify({ id, method, params }))
    })
}

async function waitForJson(url) {
  let last = 'not ready'
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
      last = `HTTP ${response.status}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await sleep(200)
  }
  throw new Error(`${url} was not ready (${last})`)
}

async function waitForPage(port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const list = await waitForJson(`http://127.0.0.1:${port}/json/list`)
    const page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
    if (page !== undefined) return page
    await sleep(200)
  }
  throw new Error('Electron did not expose a page target')
}

async function waitForApp(call) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await call('Runtime.evaluate', {
      expression: 'typeof window.app?.resumeSources?.discover === "function"',
      returnByValue: true,
    })
    if (result.result?.value === true) return
    await sleep(250)
  }
  throw new Error('window.app.resumeSources.discover was not ready')
}

function waitForDatabase(dbPath) {
  return (async () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const db = new DatabaseSync(dbPath)
        const row = db.prepare("SELECT name FROM sqlite_master WHERE name = 'projects'").get()
        db.close()
        if (row !== undefined) return
      } catch {
        // App creates database on startup
      }
      await sleep(200)
    }
    throw new Error(`database was not created at ${dbPath}`)
  })()
}

const scratch = mkdtempSync(join(tmpdir(), 'nekode-resume-smoke-'))
const userData = join(scratch, 'user-data')
const projectDir = join(scratch, 'project')
mkdirSync(userData, { recursive: true })
mkdirSync(projectDir, { recursive: true })

// 1. Generic file source target
const notesDir = join(projectDir, 'notes')
mkdirSync(notesDir, { recursive: true })
const noteFile = join(notesDir, 'TASK-1.txt')
writeFileSync(noteFile, 'Step 1 completed\nStep 2 in progress')

// 2. Harness mock target
const harnessTasksDir = join(projectDir, '.agents', 'tasks', 'smoke-task')
mkdirSync(harnessTasksDir, { recursive: true })
const harnessTaskFile = join(harnessTasksDir, 'task.md')
writeFileSync(harnessTaskFile, '# Smoke task\n\nCanonical progress\n')

const harnessScriptsDir = join(projectDir, '.agents', 'scripts')
mkdirSync(harnessScriptsDir, { recursive: true })
const mockTaskctlPy = join(harnessScriptsDir, 'taskctl')
writeFileSync(
  mockTaskctlPy,
  `import json, sys
if "--json" in sys.argv and "list" in sys.argv:
    print(json.dumps({
        "success": True,
        "tasks": [{
            "id": "smoke-task",
            "title": "Smoke task title",
            "path": ".agents/tasks/smoke-task/task.md",
            "status": "active",
            "current_phase": "Phase 2",
            "current_step": "Step 2.2",
            "next_action": "Verify smoke",
            "awaiting_resumption": True
        }]
    }))
    sys.exit(0)
sys.exit(1)
`,
)

const port = await freePort()
const child = spawn(electron, ['.', `--remote-debugging-port=${port}`], {
  cwd: root,
  env: {
    ...process.env,
    NEKODE_USER_DATA: userData,
  },
  stdio: ['ignore', 'ignore', 'pipe'],
})

let browser
let page

try {
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`)
  browser = await openSocket(version.webSocketDebuggerUrl)
  const browserCall = cdp(browser)
  const target = await waitForPage(port)
  page = await openSocket(target.webSocketDebuggerUrl)
  const pageCall = cdp(page)
  await waitForApp(pageCall)
  await waitForDatabase(join(userData, 'nekode.db'))

  const db = new DatabaseSync(join(userData, 'nekode.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  db.prepare(
    'INSERT INTO projects (id, name, path, path_identity, runtime_label, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
  ).run(projectId, 'ResumeSmoke', projectDir, projectDir.toLowerCase(), new Date().toISOString())
  db.close()

  // Test 1: Save custom generic file template
  const fileTemplateResult = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.put({
      id: null,
      revision: null,
      name: 'Smoke Notes',
      prompt: 'Resume note {taskPath}',
      source: {
        kind: 'files',
        directory: 'notes',
        pattern: '*.txt',
        recursive: false,
        identity: 'stem'
      }
    })`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (fileTemplateResult.exceptionDetails !== undefined) {
    throw new Error(
      `file template put rejected: ${JSON.stringify(fileTemplateResult.exceptionDetails)}`,
    )
  }
  const fileTemplate = fileTemplateResult.result?.value?.templates?.find(
    (t) => t.name === 'Smoke Notes',
  )
  if (!fileTemplate) throw new Error('Smoke Notes template was not saved')

  // Test 2: Bind project to custom file template and verify in-use protection
  const bindCall = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.bind('${projectId}', '${fileTemplate.id}')`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (bindCall.exceptionDetails !== undefined) {
    throw new Error(`bind rejected: ${JSON.stringify(bindCall.exceptionDetails)}`)
  }

  // Deleting template now must be rejected with in-use error naming project
  const deleteFailCall = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.delete('${fileTemplate.id}', ${fileTemplate.revision}).catch(e => ({ error: e.message }))`,
    awaitPromise: true,
    returnByValue: true,
  })
  const deleteFail = deleteFailCall.result?.value
  if (!deleteFail?.error?.includes('ResumeSmoke')) {
    throw new Error(`delete in-use template did not name project: ${JSON.stringify(deleteFail)}`)
  }

  // Test 3: Discover generic files
  const discoverCall = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.discover('${projectId}', 'smoke-req-1')`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (discoverCall.exceptionDetails !== undefined) {
    throw new Error(`discover rejected: ${JSON.stringify(discoverCall.exceptionDetails)}`)
  }
  const discovery = discoverCall.result?.value
  if (discovery?.candidates?.length !== 1) {
    throw new Error(`unexpected file discovery candidates: ${JSON.stringify(discovery)}`)
  }
  const fileCand = discovery.candidates[0]
  if (fileCand.id !== 'TASK-1' || !fileCand.token) {
    throw new Error(`invalid candidate data: ${JSON.stringify(fileCand)}`)
  }
  if (fileCand.token.includes(noteFile)) {
    throw new Error('token must be opaque and not leak file path')
  }

  // Test 4: Prepare prompt from token
  const prepareCall = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.prepare('${projectId}', '${fileCand.token}', 'smoke-req-2')`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (prepareCall.exceptionDetails !== undefined) {
    throw new Error(`prepare rejected: ${JSON.stringify(prepareCall.exceptionDetails)}`)
  }
  const prompt = prepareCall.result?.value
  if (typeof prompt !== 'string' || !prompt.startsWith('Resume note notes')) {
    throw new Error(`unexpected prepared prompt: ${prompt}`)
  }

  // Test 5: Re-using the same token must fail (consumed once)
  const duplicatePrepare = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.prepare('${projectId}', '${fileCand.token}', 'smoke-req-3').catch(e => ({ error: e.message }))`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (!duplicatePrepare.result?.value?.error) {
    throw new Error('re-using consumed token did not reject')
  }

  // Test 6: Bind to Agent Harness preset and discover
  const bindHarnessCall = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.bind('${projectId}', 'agent-harness')`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (bindHarnessCall.exceptionDetails !== undefined) {
    throw new Error(`harness bind rejected: ${JSON.stringify(bindHarnessCall.exceptionDetails)}`)
  }

  const harnessDiscoverCall = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.discover('${projectId}', 'smoke-req-4')`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (harnessDiscoverCall.exceptionDetails !== undefined) {
    throw new Error(
      `harness discover rejected: ${JSON.stringify(harnessDiscoverCall.exceptionDetails)}`,
    )
  }
  const harnessDiscovery = harnessDiscoverCall.result?.value
  if (harnessDiscovery?.candidates?.length !== 1) {
    throw new Error(`unexpected harness discovery: ${JSON.stringify(harnessDiscovery)}`)
  }
  const harnessCand = harnessDiscovery.candidates[0]
  if (harnessCand.id !== 'smoke-task' || harnessCand.status !== 'active') {
    throw new Error(`unexpected harness candidate: ${JSON.stringify(harnessCand)}`)
  }

  const harnessPrepareCall = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.prepare('${projectId}', '${harnessCand.token}', 'smoke-req-5')`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (harnessPrepareCall.exceptionDetails !== undefined) {
    throw new Error(
      `harness prepare rejected: ${JSON.stringify(harnessPrepareCall.exceptionDetails)}`,
    )
  }
  const harnessPrompt = harnessPrepareCall.result?.value
  if (
    typeof harnessPrompt !== 'string' ||
    !harnessPrompt.replaceAll('\\', '/').includes('.agents/tasks/smoke-task/task.md')
  ) {
    throw new Error(`unexpected harness prompt: ${harnessPrompt}`)
  }

  process.stdout.write(
    'Stage 2 Resume source smoke passed: file and Harness discovery, bindings, in-use guards, and token preparation verified.\n',
  )

  try {
    await browserCall('Browser.close', {}, 1000)
  } catch {
    // Ignore close timeout
  }
  browser = undefined
} finally {
  page?.close()
  browser?.close()
  if (child.exitCode === null && child.signalCode === null) {
    child.kill()
  }
  await Promise.race([
    new Promise((resolveExit) => {
      if (child.exitCode !== null || child.signalCode !== null) resolveExit()
      else child.once('exit', () => resolveExit())
    }),
    sleep(5000).then(() => {
      child.kill()
    }),
  ])
  rmSync(scratch, { recursive: true, force: true })
}
