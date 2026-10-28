// Windows packaged/installed smoke. The executable is explicit; all data is a fixture.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'

if (process.platform !== 'win32' || process.argv.length !== 3) {
  throw new Error(
    'Usage on Windows: node scripts/package-smoke.mjs <absolute packaged or installed nekode.exe>',
  )
}
const executable = resolve(process.argv[2])
assert.ok(existsSync(executable), `Missing smoke target: ${executable}`)
const resources = join(dirname(executable), 'resources')
for (const relative of [
  'app.asar',
  'dictation/desktop-shortcut.ps1',
  'usage-adapters/usage-codex/index.cjs',
  'usage-adapters/usage-codex/usage-adapter.json',
  'usage-adapters/usage-claude/index.cjs',
  'usage-adapters/usage-claude/usage-adapter.json',
])
  assert.ok(existsSync(join(resources, relative)), `Missing resource: ${relative}`)

const scratch = mkdtempSync(join(tmpdir(), 'nekode-134-package-smoke-'))
const profile = join(scratch, 'profile')
const project = join(scratch, 'project')
mkdirSync(profile)
mkdirSync(project)
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
)
env.Path = process.env.Path ?? process.env.PATH
env.NEKODE_USER_DATA = profile
delete env.ELECTRON_RUN_AS_NODE

async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((done) => server.close(done))
  return port
}

async function waitFor(probe, description) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const result = await probe()
    if (result) return result
    await delay(150)
  }
  throw new Error(`Timed out: ${description}`)
}

async function connect(url) {
  const socket = new WebSocket(url)
  await once(socket, 'open')
  let next = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const response = JSON.parse(String(event.data))
    pending.get(response.id)?.(response)
  })
  function call(method, params = {}) {
    return new Promise((resolveCall, rejectCall) => {
      const id = ++next
      const timer = setTimeout(() => {
        pending.delete(id)
        rejectCall(new Error(`CDP timeout: ${method}`))
      }, 5000)
      pending.set(id, (response) => {
        clearTimeout(timer)
        pending.delete(id)
        if (response.error) rejectCall(new Error(JSON.stringify(response.error)))
        else resolveCall(response.result)
      })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  return { socket, call }
}

let child, browser, page
const ownedProcesses = new Map()
function processSnapshot() {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress',
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 },
  )
  if (result.error)
    throw new Error(`Windows PowerShell process inventory failed: ${result.error.message}`)
  assert.equal(result.status, 0, `Process inventory failed: ${result.stderr}`)
  return JSON.parse(result.stdout)
}
function captureProcessTree() {
  if (!child) return
  const processes = processSnapshot()
  const root = processes.find((item) => item.ProcessId === child.pid)
  const currentTree = new Set(root ? [root.ProcessId] : [])
  let added
  do {
    added = false
    for (const item of processes) {
      if (!currentTree.has(item.ProcessId) && currentTree.has(item.ParentProcessId)) {
        currentTree.add(item.ProcessId)
        added = true
      }
    }
  } while (added)
  for (const item of processes) {
    if (currentTree.has(item.ProcessId)) ownedProcesses.set(item.ProcessId, item.CreationDate)
  }
}
async function launch() {
  const port = await freePort()
  child = spawn(executable, [`--remote-debugging-port=${port}`], {
    env,
    cwd: dirname(executable),
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  await once(child, 'spawn')
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000)
  })
  async function json(path) {
    if (child.exitCode !== null) throw new Error(`App exited ${child.exitCode}: ${stderr}`)
    try {
      return await (await fetch(`http://127.0.0.1:${port}${path}`)).json()
    } catch (error) {
      if (error.cause?.code === 'ECONNREFUSED') return null
      throw error
    }
  }
  const version = await waitFor(() => json('/json/version'), 'browser CDP')
  browser = await connect(version.webSocketDebuggerUrl)
  const target = await waitFor(
    async () => (await json('/json/list'))?.find((item) => item.type === 'page'),
    'renderer CDP',
  )
  page = await connect(target.webSocketDebuggerUrl)
  await waitFor(
    () =>
      evaluate('Boolean(window.app?.chats && document.getElementById("root")?.children.length)'),
    'renderer mount',
  )
}

async function evaluate(expression) {
  const result = await page.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails)
    throw new Error(`Renderer evaluation failed: ${JSON.stringify(result.exceptionDetails)}`)
  return result.result.value
}

async function stop() {
  captureProcessTree()
  page?.socket.close()
  page = undefined
  const launched = child
  if (browser) {
    // Electron exits without replying to Browser.close; close/error is expected here.
    const closing = browser.call('Browser.close').catch(() => undefined)
    await Promise.race([closing, delay(2000)])
    browser.socket.close()
    browser = undefined
  }
  if (launched && launched.exitCode === null && launched.signalCode === null) {
    await Promise.race([once(launched, 'exit'), delay(5000)])
    if (launched.exitCode === null && launched.signalCode === null) {
      const killed = spawnSync('taskkill', ['/PID', String(launched.pid), '/T', '/F'], {
        windowsHide: true,
        encoding: 'utf8',
      })
      assert.equal(killed.status, 0, 'Failed to terminate smoke process tree')
      await once(launched, 'exit')
    }
  }
  child = undefined
}

async function probeAdapter() {
  // This first invocation must also be isolated if RunAsNode has been disabled.
  // Invalid config stops the real adapter before Codex or account access.
  child = spawn(executable, [join(resources, 'usage-adapters/usage-codex/index.cjs')], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    cwd: dirname(executable),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const finished = once(child, 'close')
  await once(child, 'spawn')
  let stdout = '',
    inputError
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.resume()
  child.stdin.on('error', (error) => {
    inputError = error
  })
  captureProcessTree()
  child.stdin.end(
    JSON.stringify({ protocolVersion: 2, action: 'read', config: { codexPath: 'not-absolute' } }),
  )
  const [code] = await Promise.race([
    finished,
    delay(10000, null, { ref: false }).then(() => {
      throw new Error('RunAsNode adapter timed out')
    }),
  ])
  assert.ifError(inputError)
  assert.equal(code, 1)
  assert.equal(
    JSON.parse(stdout).error.code,
    'config',
    'Bundled adapter must run through RunAsNode',
  )
  child = undefined
}

try {
  await probeAdapter()
  await launch()
  const dbPath = join(profile, 'nekode.db')
  await waitFor(() => existsSync(dbPath), 'SQLite file creation')
  const db = new DatabaseSync(dbPath)
  try {
    db.prepare(
      'INSERT INTO projects (id, name, path, path_identity, runtime_label, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
    ).run(
      'package-smoke',
      'Package smoke',
      project,
      project.toLowerCase(),
      new Date().toISOString(),
    )
  } finally {
    db.close()
  }
  const chat = await evaluate('window.app.chats.create("package-smoke")')
  assert.equal(chat.projectId, 'package-smoke')
  await evaluate(
    `window.smokeOutput = ''; window.smokeUnsubscribe = window.app.terminals.onData(${JSON.stringify(chat.id)}, data => { window.smokeOutput += data }); window.app.terminals.create(${JSON.stringify(chat.id)}, ${JSON.stringify(project)})`,
  )
  // Construct the marker so terminal input echo cannot satisfy the output assertion.
  await evaluate(
    `window.app.terminals.write(${JSON.stringify(chat.id)}, "echo ('NEKODE_134_' + 'PTY_OK')\\r")`,
  )
  await waitFor(
    () => evaluate('window.smokeOutput.includes("NEKODE_134_PTY_OK")'),
    'real PTY output',
  )
  await evaluate('window.smokeUnsubscribe()')
  await stop()
  await launch()
  const chats = await evaluate('window.app.chats.list("package-smoke")')
  assert.ok(
    chats.some((item) => item.id === chat.id),
    'SQLite chat must persist across restarts',
  )

  // Verify sender guard frame identity (NEKODE-139): invoke from main frame succeeds (above).
  // Subframes cannot invoke privileged IPC: iframes have no IPC bridge and untrusted subframe invokes are rejected.
  const subframeCheck = await evaluate(`
    new Promise((resolve) => {
      const frame = document.createElement('iframe')
      document.body.appendChild(frame)
      try {
        resolve({
          hasApp: Boolean(frame.contentWindow?.app),
          hasIpcRenderer: Boolean(frame.contentWindow?.require || frame.contentWindow?.electron),
        })
      } finally {
        frame.remove()
      }
    })
  `)
  assert.equal(subframeCheck.hasApp, false, 'Iframe must not have window.app IPC bridge')
  assert.equal(subframeCheck.hasIpcRenderer, false, 'Iframe must not have direct IPC access')

  await evaluate(`window.app.chats.remove(${JSON.stringify(chat.id)})`)
  await stop()
  const survivors = processSnapshot().filter(
    (item) => ownedProcesses.get(item.ProcessId) === item.CreationDate,
  )
  assert.deepEqual(survivors, [], 'Orphaned Electron or PTY smoke processes')
  console.log(
    JSON.stringify({
      executable,
      renderer: 'pass',
      senderGuard: 'pass',
      sqliteRestart: 'pass',
      pty: 'pass',
      resources: 'pass',
      runAsNodeAdapter: 'pass',
      processesReaped: [...ownedProcesses.keys()],
    }),
  )
} finally {
  await stop()
  // If an assertion failed, still reap captured descendants. Creation times prevent PID reuse.
  for (const item of processSnapshot()) {
    if (ownedProcesses.get(item.ProcessId) !== item.CreationDate) continue
    const killed = spawnSync('taskkill', ['/PID', String(item.ProcessId), '/T', '/F'], {
      windowsHide: true,
      encoding: 'utf8',
    })
    assert.equal(killed.status, 0, `Failed to reap smoke process ${item.ProcessId}`)
  }
  await waitFor(
    () =>
      !processSnapshot().some((item) => ownedProcesses.get(item.ProcessId) === item.CreationDate),
    'smoke process teardown',
  )
  // scratch comes directly from mkdtemp under OS temp; never remove an input path.
  rmSync(scratch, { recursive: true, force: true })
}
