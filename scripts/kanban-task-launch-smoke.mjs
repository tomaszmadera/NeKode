// Stage 3 + 5 smoke: a real Electron process launches a local fixture CLI.
// The fixture prints argv and cwd; it does not call a model. Stage 5 adds a
// Resume over a real handoff file written into the project, so the Resume
// prompt's path is the project-relative form.

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const nodeExe = process.execPath
const LEAK = 'PROMPT_LEAK_SMOKE'
const projectId = 'p-smoke'
const description = `Quote "here"\nnext & | ; \` ${LEAK}`
const itemUrl = 'https://example.test/smk?q=1&x=2'
const handoffFileName = 'smk-1-handoff.md'

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
  return (method, params = {}, timeoutMs = 20000) =>
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
      expression: 'typeof window.app?.kanban?.launchTask === "function"',
      returnByValue: true,
    })
    if (result.result?.value === true) return
    await sleep(250)
  }
  throw new Error('window.app.kanban.launchTask was not ready')
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
        // The app creates the file after ready.
      }
      await sleep(200)
    }
    throw new Error(`database was not created at ${dbPath}`)
  })()
}

const scratch = mkdtempSync(join(tmpdir(), 'nekode-task-launch-smoke-'))
const userData = join(scratch, 'user-data')
const projectDir = join(scratch, 'project')
const outFile = join(scratch, 'fixture-out.json')
mkdirSync(userData, { recursive: true })
mkdirSync(projectDir, { recursive: true })
mkdirSync(join(userData, 'kanban-adapters', 'fixture'), { recursive: true })

// A real handoff directory inside the project: the Resume prompt path is the
// project-relative form and the file exists for the matcher scan.
const handoffDir = join(projectDir, 'handoffs')
mkdirSync(handoffDir, { recursive: true })
writeFileSync(
  join(handoffDir, handoffFileName),
  '---\nwork_item_ref: SMK-1\n---\n\n# Smoke handoff\n\nReconcile with the repository.\n',
)

const adapterScript = join(scratch, 'adapter.mjs')
const fixtureScript = join(scratch, 'fixture.mjs')
writeFileSync(
  adapterScript,
  `import { readFileSync } from 'node:fs'
const request = JSON.parse(readFileSync(0, 'utf8'))
if (request.action !== 'getItem' || request.params?.ref !== 'SMK-1') {
  process.stdout.write(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'missing item' } }))
  process.exit(1)
}
process.stdout.write(JSON.stringify({
  ok: true,
  data: {
    ref: 'SMK-1',
    id: 'native-smoke',
    title: 'Smoke launch',
    description: ${JSON.stringify(description)},
    stateId: 'st1',
    stateName: 'Started',
    stateGroup: 'started',
    priority: null,
    assignee: null,
    url: ${JSON.stringify(itemUrl)},
    updatedAt: null,
  },
}))
`,
)
writeFileSync(
  fixtureScript,
  `import { writeFileSync } from 'node:fs'
const payload = JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(1) })
process.stdout.write(payload + '\\n')
const out = process.env.NEKODE_TASK_LAUNCH_OUT
if (out) writeFileSync(out, payload)
`,
)
writeFileSync(
  join(userData, 'kanban-adapters', 'fixture', 'adapter.json'),
  JSON.stringify({
    id: 'fixture',
    name: 'Fixture',
    protocolVersion: 1,
    invocation: { command: nodeExe, args: [adapterScript] },
    configSchema: [],
  }),
)

const port = await freePort()
const stderr = []
let fullStderr = ''
const child = spawn(electron, ['.', `--remote-debugging-port=${port}`], {
  cwd: root,
  env: {
    ...process.env,
    NEKODE_USER_DATA: userData,
    NEKODE_TASK_LAUNCH_OUT: outFile,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stderr?.on('data', (chunk) => {
  const piece = chunk.toString('utf8')
  fullStderr += piece
  stderr.push(piece)
  const text = stderr.join('')
  if (text.length > 8000) stderr.splice(0, stderr.length - 1, text.slice(-8000))
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
  ).run(projectId, 'Smoke', projectDir, projectDir.toLowerCase(), new Date().toISOString())
  const state = db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?)')
  state.run(`project.kanbanAdapter:${projectId}`, 'fixture')
  state.run(`project.kanbanConfig:${projectId}`, '{}')
  state.run(`project.handoffDir:${projectId}`, handoffDir)
  state.run(
    `project.agentProfiles:${projectId}`,
    JSON.stringify({
      defaultId: 'prof-smoke',
      profiles: [
        {
          id: 'prof-smoke',
          name: 'Fixture CLI',
          executable: nodeExe,
          args: [fixtureScript, '{prompt}'],
        },
      ],
    }),
  )
  db.close()

  const launched = await pageCall('Runtime.evaluate', {
    expression: `window.app.kanban.launchTask(${JSON.stringify({
      projectId,
      itemId: 'native-smoke',
      ref: 'SMK-1',
      profileId: 'prof-smoke',
      attemptId: 'attempt-smoke',
      mode: 'start',
    })}).then((result) => ({ name: result.chat.name, delivered: result.delivered }))`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (launched.exceptionDetails !== undefined) {
    throw new Error(`launchTask rejected: ${JSON.stringify(launched.exceptionDetails)}`)
  }
  const summary = launched.result?.value
  if (summary?.delivered !== true || !summary.name?.endsWith('Fixture CLI')) {
    throw new Error(`unexpected launch result: ${JSON.stringify(summary)}`)
  }

  let printed = ''
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      printed = readFileSync(outFile, 'utf8')
      break
    } catch {
      await sleep(100)
    }
  }
  if (printed.length === 0) throw new Error('the fixture did not write its argv')
  const parsed = JSON.parse(printed)
  if (resolve(parsed.cwd) !== resolve(projectDir)) {
    throw new Error(`fixture cwd was ${parsed.cwd}`)
  }
  if (!Array.isArray(parsed.argv) || parsed.argv.length !== 2) {
    throw new Error(`fixture argv was not one prompt argument: ${printed}`)
  }
  if (parsed.argv[0] !== fixtureScript) {
    throw new Error(`fixture script arg was ${parsed.argv[0]}`)
  }
  const prompt = parsed.argv[1]
  if (typeof prompt !== 'string' || !prompt.startsWith('Work on task SMK-1: Smoke launch.')) {
    throw new Error('the prompt was not the single argv element')
  }
  for (const piece of ['\n', '"', '&', '|', ';', '`', LEAK, itemUrl]) {
    if (!prompt.includes(piece)) throw new Error(`prompt is missing ${JSON.stringify(piece)}`)
  }
  if (!prompt.includes('Keep the full ref in the name of the local task record')) {
    throw new Error('the prompt is missing the task record instruction')
  }
  if (prompt.includes(handoffDir)) {
    throw new Error('the start prompt must not include the legacy handoff directory')
  }
  for (const secret of [LEAK, itemUrl, 'Quote "here"']) {
    if (fullStderr.includes(secret)) throw new Error('Electron stderr included launch prompt data')
  }
  process.stdout.write(`${printed}\n`)

  // Resume (NEKODE-142 Stage 3):
  // 1. Generic file source Resume:
  // Register reusable template and bind to project.
  const genericTemplate = {
    id: null,
    revision: null,
    name: 'Generic files',
    prompt: 'Resume from {taskPath}',
    source: {
      kind: 'files',
      directory: 'handoffs',
      pattern: '*.md',
      recursive: false,
      identity: 'stem',
    },
  }
  const putGeneric = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.put(${JSON.stringify(genericTemplate)})`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (putGeneric.exceptionDetails !== undefined) {
    throw new Error(`put template failed: ${JSON.stringify(putGeneric.exceptionDetails)}`)
  }
  const genericLibrary = putGeneric.result?.value
  const createdGeneric = genericLibrary?.templates?.find((t) => t.name === 'Generic files')
  if (!createdGeneric) throw new Error('created generic template not found')
  await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.bind(${JSON.stringify(projectId)}, ${JSON.stringify(createdGeneric.id)})`,
    awaitPromise: true,
    returnByValue: true,
  })

  // Discover candidates from the generic file source.
  const scanCall = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.discover(${JSON.stringify(projectId)}, 'req-smoke-file')`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (scanCall.exceptionDetails !== undefined) {
    throw new Error(`discover rejected: ${JSON.stringify(scanCall.exceptionDetails)}`)
  }
  const scan = scanCall.result?.value
  const candidate = scan.candidates?.find((entry) => entry.id === 'smk-1-handoff')
  if (!candidate) {
    throw new Error(`file candidate smk-1-handoff not found: ${JSON.stringify(scan)}`)
  }

  // Prepare prompt for file candidate.
  const prepCall = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.prepare(${JSON.stringify(projectId)}, ${JSON.stringify(candidate.token)}, 'req-smoke-file')`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (prepCall.exceptionDetails !== undefined) {
    throw new Error(`prepare rejected: ${JSON.stringify(prepCall.exceptionDetails)}`)
  }
  const resumePrompt = prepCall.result?.value
  const expectedFilePrompt = `Resume from ${join('handoffs', 'smk-1-handoff.md')}`
  if (resumePrompt !== expectedFilePrompt) {
    throw new Error(`unexpected prepared prompt: ${resumePrompt}`)
  }

  // Launch Resume with the prepared prompt.
  rmSync(outFile, { force: true })
  const resumeLaunch = await pageCall('Runtime.evaluate', {
    expression: `window.app.kanban.launchTask(${JSON.stringify({
      projectId,
      itemId: 'native-smoke',
      ref: 'SMK-1',
      profileId: 'prof-smoke',
      attemptId: 'attempt-smoke-resume-file',
      mode: 'resume',
      prompt: resumePrompt,
    })}).then((result) => ({ name: result.chat.name, delivered: result.delivered }))`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (resumeLaunch.exceptionDetails !== undefined) {
    throw new Error(`resume launchTask rejected: ${JSON.stringify(resumeLaunch.exceptionDetails)}`)
  }
  const resumeSummary = resumeLaunch.result?.value
  if (resumeSummary?.delivered !== true || !resumeSummary.name?.endsWith('Fixture CLI')) {
    throw new Error(`unexpected resume result: ${JSON.stringify(resumeSummary)}`)
  }
  let resumePrinted = ''
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      resumePrinted = readFileSync(outFile, 'utf8')
      break
    } catch {
      await sleep(100)
    }
  }
  if (resumePrinted.length === 0) throw new Error('the resume fixture did not write its argv')
  const resumeParsed = JSON.parse(resumePrinted)
  if (resolve(resumeParsed.cwd) !== resolve(projectDir)) {
    throw new Error(`resume fixture cwd was ${resumeParsed.cwd}`)
  }
  if (!Array.isArray(resumeParsed.argv) || resumeParsed.argv.length !== 2) {
    throw new Error(`resume fixture argv was not one prompt argument: ${resumePrinted}`)
  }
  if (resumeParsed.argv[0] !== fixtureScript) {
    throw new Error(`resume fixture script arg was ${resumeParsed.argv[0]}`)
  }
  if (resumeParsed.argv[1] !== expectedFilePrompt) {
    throw new Error(`the resume prompt was not the single argv element: ${resumePrinted}`)
  }
  for (const secret of [LEAK, itemUrl, expectedFilePrompt]) {
    if (fullStderr.includes(secret)) {
      throw new Error('Electron stderr included resume prompt data')
    }
  }
  process.stdout.write(`Generic file resume: ${resumePrinted}\n`)

  // 2. Stale selection and token revalidation:
  // Reusing an already-prepared token must reject.
  const reuseCall = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.prepare(${JSON.stringify(projectId)}, ${JSON.stringify(candidate.token)}, 'req-smoke-reuse').catch((err) => ({ error: err.message }))`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (!reuseCall.result?.value?.error) {
    throw new Error('reusing already prepared token must fail')
  }

  // Modifying the candidate file before prepare must reject with conflict.
  const scanFresh = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.discover(${JSON.stringify(projectId)}, 'req-smoke-fresh')`,
    awaitPromise: true,
    returnByValue: true,
  })
  const freshCandidate = scanFresh.result?.value?.candidates?.find(
    (entry) => entry.id === 'smk-1-handoff',
  )
  if (!freshCandidate) throw new Error('fresh candidate not found')
  writeFileSync(join(handoffDir, handoffFileName), '# Stale modified content\n')
  const stalePrep = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.prepare(${JSON.stringify(projectId)}, ${JSON.stringify(freshCandidate.token)}, 'req-smoke-stale').catch((err) => ({ error: err.message }))`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (!stalePrep.result?.value?.error) {
    throw new Error('preparing candidate after content changed must fail with conflict')
  }

  // 3. Agent Harness command source discovery and Resume:
  const harnessScriptsDir = join(projectDir, '.agents', 'scripts')
  mkdirSync(harnessScriptsDir, { recursive: true })
  const mockTaskctl = join(harnessScriptsDir, 'taskctl')
  writeFileSync(
    mockTaskctl,
    `import sys, json
if '--json' in sys.argv:
    print(json.dumps({
        "success": True,
        "tasks": [{
            "id": "SMK-1",
            "title": "Smoke task in harness",
            "path": ".agents/tasks/smk-1/task.md",
            "status": "active",
            "current_phase": "implementation",
            "current_step": "verification",
            "next_action": "run tests",
            "awaiting_resumption": True
        }]
    }))
`,
  )
  const harnessTaskDir = join(projectDir, '.agents', 'tasks', 'smk-1')
  mkdirSync(harnessTaskDir, { recursive: true })
  writeFileSync(join(harnessTaskDir, 'task.md'), '# Smoke task in harness\n')

  await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.bind(${JSON.stringify(projectId)}, 'agent-harness')`,
    awaitPromise: true,
    returnByValue: true,
  })
  const harnessScanCall = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.discover(${JSON.stringify(projectId)}, 'req-smoke-harness')`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (harnessScanCall.exceptionDetails !== undefined) {
    throw new Error(
      `harness discover rejected: ${JSON.stringify(harnessScanCall.exceptionDetails)}`,
    )
  }
  const harnessScan = harnessScanCall.result?.value
  const harnessCandidate = harnessScan.candidates?.find((entry) => entry.id === 'SMK-1')
  if (!harnessCandidate) {
    throw new Error(`harness candidate SMK-1 not found: ${JSON.stringify(harnessScan)}`)
  }

  const harnessPrep = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.prepare(${JSON.stringify(projectId)}, ${JSON.stringify(harnessCandidate.token)}, 'req-smoke-harness')`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (harnessPrep.exceptionDetails !== undefined) {
    throw new Error(`harness prepare rejected: ${JSON.stringify(harnessPrep.exceptionDetails)}`)
  }
  const harnessPrompt = harnessPrep.result?.value
  const expectedHarnessPrompt = `Resume task ${join('.agents', 'tasks', 'smk-1', 'task.md')}`
  if (harnessPrompt !== expectedHarnessPrompt) {
    throw new Error(`unexpected harness prompt: ${harnessPrompt}`)
  }

  rmSync(outFile, { force: true })
  const harnessLaunch = await pageCall('Runtime.evaluate', {
    expression: `window.app.kanban.launchTask(${JSON.stringify({
      projectId,
      itemId: 'native-smoke',
      ref: 'SMK-1',
      profileId: 'prof-smoke',
      attemptId: 'attempt-smoke-resume-harness',
      mode: 'resume',
      prompt: harnessPrompt,
    })}).then((result) => ({ name: result.chat.name, delivered: result.delivered }))`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (harnessLaunch.exceptionDetails !== undefined) {
    throw new Error(
      `harness launchTask rejected: ${JSON.stringify(harnessLaunch.exceptionDetails)}`,
    )
  }
  const harnessSummary = harnessLaunch.result?.value
  if (harnessSummary?.delivered !== true) {
    throw new Error(`unexpected harness launch result: ${JSON.stringify(harnessSummary)}`)
  }
  let harnessPrinted = ''
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      harnessPrinted = readFileSync(outFile, 'utf8')
      break
    } catch {
      await sleep(100)
    }
  }
  const harnessParsed = JSON.parse(harnessPrinted)
  if (harnessParsed.argv[1] !== expectedHarnessPrompt) {
    throw new Error(`unexpected harness argv: ${harnessPrinted}`)
  }
  process.stdout.write(`Harness resume: ${harnessPrinted}\n`)

  // 4. Start remains fully functional after Resume source failure:
  const brokenTemplate = {
    id: null,
    revision: null,
    name: 'Broken template',
    prompt: 'Resume {taskPath}',
    source: {
      kind: 'command',
      protocol: 'generic',
      executable: 'nonexistent-smoke-bin-never-exists',
      args: ['--fail'],
    },
  }
  const putBroken = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.put(${JSON.stringify(brokenTemplate)})`,
    awaitPromise: true,
    returnByValue: true,
  })
  const brokenLibrary = putBroken.result?.value
  const createdBroken = brokenLibrary?.templates?.find((t) => t.name === 'Broken template')
  if (!createdBroken) throw new Error('created broken template not found')
  await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.bind(${JSON.stringify(projectId)}, ${JSON.stringify(createdBroken.id)})`,
    awaitPromise: true,
    returnByValue: true,
  })
  const brokenScan = await pageCall('Runtime.evaluate', {
    expression: `window.app.resumeSources.discover(${JSON.stringify(projectId)}, 'req-broken').catch((err) => ({ error: err.message }))`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (!brokenScan.result?.value?.error) {
    throw new Error('broken template discover should fail')
  }

  rmSync(outFile, { force: true })
  const startAfterFail = await pageCall('Runtime.evaluate', {
    expression: `window.app.kanban.launchTask(${JSON.stringify({
      projectId,
      itemId: 'native-smoke',
      ref: 'SMK-1',
      profileId: 'prof-smoke',
      attemptId: 'attempt-smoke-start-after-fail',
      mode: 'start',
    })}).then((result) => ({ name: result.chat.name, delivered: result.delivered }))`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (startAfterFail.exceptionDetails !== undefined) {
    throw new Error(
      `start after source failure rejected: ${JSON.stringify(startAfterFail.exceptionDetails)}`,
    )
  }
  const startAfterFailSummary = startAfterFail.result?.value
  if (startAfterFailSummary?.delivered !== true) {
    throw new Error(
      `start after failure was not delivered: ${JSON.stringify(startAfterFailSummary)}`,
    )
  }
  let startAfterFailPrinted = ''
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      startAfterFailPrinted = readFileSync(outFile, 'utf8')
      break
    } catch {
      await sleep(100)
    }
  }
  const startAfterFailParsed = JSON.parse(startAfterFailPrinted)
  if (!startAfterFailParsed.argv[1]?.startsWith('Work on task SMK-1: Smoke launch.')) {
    throw new Error(`unexpected start prompt after failure: ${startAfterFailPrinted}`)
  }
  process.stdout.write(`Start after source failure: ${startAfterFailPrinted}\n`)

  // Electron never acknowledges Browser.close, so bound the wait and ignore
  // its timeout here; the finally block owns killing the process and cleanup.
  try {
    await browserCall('Browser.close', {}, 1000)
  } catch {
    // Expected: Electron exits without a CDP reply to Browser.close.
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

void pathToFileURL
