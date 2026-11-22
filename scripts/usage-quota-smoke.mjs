// Windows Electron smoke with an isolated profile and fixture-only quota data.
// NEKODE-191 Stage 2: a fixture hub speaks adapter protocol 3, document schema 2 and declares
// ChatGPT, Claude, Google AI and OpenCode Go. The smoke proves the subscription headings, a
// per-subscription refresh, a pinned OpenCode Go row, the schema 2 export and the v2 rejection.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const evidence = join(root, 'tmp', 'nekode-191-stage2-smoke')
mkdirSync(evidence, { recursive: true })
const scratch = mkdtempSync(join(tmpdir(), 'nekode-usage-smoke-'))
const profile = join(scratch, 'profile'),
  output = join(scratch, 'export.json')
const hubDir = join(profile, 'usage-adapters', 'fixture-hub'),
  v2Dir = join(profile, 'usage-adapters', 'legacy-v2'),
  pidFile = join(scratch, 'adapter-pids.txt'),
  actionsFile = join(scratch, 'adapter-actions.jsonl')
mkdirSync(hubDir, { recursive: true })
mkdirSync(v2Dir, { recursive: true })
const report = {
  target: 'Windows Electron built out/',
  fixtureOnly: true,
  scratch,
  assertions: [],
  cleanup: {},
  error: null,
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function freePort() {
  const server = createServer()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  await new Promise((r) => server.close(r))
  return port
}
async function json(url) {
  for (let n = 0; n < 100; n++) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
    } catch {}
    await sleep(150)
  }
  throw new Error(`Not ready: ${url}`)
}
async function socket(url) {
  const ws = new WebSocket(url)
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true })
    ws.addEventListener('error', j, { once: true })
  })
  return ws
}
function cdp(ws) {
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const m = JSON.parse(String(event.data)),
      p = pending.get(m.id)
    if (p) {
      pending.delete(m.id)
      clearTimeout(p.timer)
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
    }
  })
  const closed = () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('CDP closed'))
    }
    pending.clear()
  }
  ws.addEventListener('close', closed)
  ws.addEventListener('error', closed)
  return (method, params = {}, timeout = 12000) =>
    new Promise((resolveCall, reject) => {
      const current = ++id
      const timer = setTimeout(() => {
        pending.delete(current)
        reject(new Error(`CDP timeout ${method}`))
      }, timeout)
      pending.set(current, { resolve: resolveCall, reject, timer })
      ws.send(JSON.stringify({ id: current, method, params }))
    })
}
let child, browserSocket, pageSocket, inspectorSocket, call, mainCall, browserCall, fakeApi
// Sanitized Claude Code sign-in in a scratch config directory (usage-quota spec L11-L12); the
// user's real ~/.claude is never read.
const CLAUDE_TOKEN = 'fixture-claude-access-token-not-real'
const CLAUDE_REFRESH = 'fixture-claude-refresh-token-not-real'
const claudeConfig = join(scratch, 'claude-config')
const providerRequests = []
const electronPids = new Set()
async function launch() {
  const port = await freePort(),
    inspect = await freePort()
  const env = { ...process.env, NEKODE_USER_DATA: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const log = []
  child = spawn(
    join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [
      '.',
      `--remote-debugging-port=${port}`,
      `--inspect=${inspect}`,
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
    // windowsHide would start the GUI window hidden, and spec rule 12 pauses polling while hidden.
    { cwd: root, env, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const launched = child
  child.stdout.on('data', (c) => log.push(c.toString()))
  child.stderr.on('data', (c) => log.push(c.toString()))
  child.once('close', () =>
    writeFileSync(join(evidence, `electron-${launched.pid}.log`), log.join('')),
  )
  const browser = await json(`http://127.0.0.1:${port}/json/version`)
  browserSocket = await socket(browser.webSocketDebuggerUrl)
  browserCall = cdp(browserSocket)
  let page
  for (let n = 0; n < 50; n++) {
    page = (await json(`http://127.0.0.1:${port}/json/list`)).find((t) => t.type === 'page')
    if (page) break
    await sleep(100)
  }
  pageSocket = await socket(page.webSocketDebuggerUrl)
  call = cdp(pageSocket)
  const main = (await json(`http://127.0.0.1:${inspect}/json/list`))[0]
  inspectorSocket = await socket(main.webSocketDebuggerUrl)
  mainCall = cdp(inspectorSocket)
  for (let n = 0; n < 80; n++) {
    if (
      await evaluate(
        // The title-bar button exists only while Show usage quota is on (spec rule 1).
        'typeof window.app?.usage?.read === "function" && Boolean(document.querySelector("[data-testid=title-bar]"))',
      )
    ) {
      for (const pid of await evaluate(
        'process.mainModule.require("electron").app.getAppMetrics().map(p=>p.pid)',
        true,
      ))
        electronPids.add(pid)
      for (let v = 0; v < 40; v++) {
        if (
          await evaluate(
            'process.mainModule.require("electron").BrowserWindow.getAllWindows().some(w=>w.isVisible()&&!w.isMinimized())',
            true,
          )
        )
          return
        await sleep(100)
      }
      throw new Error('Electron window is not visible; automatic usage polling would stay paused')
    }
    await sleep(150)
  }
  throw new Error('Usage renderer not ready')
}
async function evaluate(expression, main = false) {
  const result = await (main ? mainCall : call)('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails)
    throw new Error(
      `${result.exceptionDetails.text}: ${JSON.stringify(result.exceptionDetails.exception)}`,
    )
  return result.result?.value
}
async function waitFor(expression, timeoutMs) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end && !(await evaluate(expression))) await sleep(250)
  return evaluate(expression)
}
async function check(name, expression) {
  const result = await evaluate(expression)
  assert.equal(result, true, name)
  report.assertions.push(name)
}
async function shot(name) {
  await call('Page.bringToFront')
  await sleep(1200)
  const image = await call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(evidence, `${name}.png`), Buffer.from(image.data, 'base64'))
}
async function close() {
  inspectorSocket?.close()
  inspectorSocket = null
  try {
    await browserCall?.('Browser.close', {}, 1000)
  } catch {}
  for (let n = 0; n < 50 && child?.exitCode === null; n++) await sleep(100)
  if (child?.exitCode === null) {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    for (let n = 0; n < 30 && child.exitCode === null; n++) await sleep(100)
  }
  pageSocket?.close()
  browserSocket?.close()
  pageSocket = null
  browserSocket = null
  assert.notEqual(child?.exitCode, null, 'Electron was reaped')
  report.cleanup[`electron-${child.pid}`] = {
    exitCode: child.exitCode,
    normal: child.exitCode === 0,
  }
  child = null
}
try {
  // Protocol 3 fixture hub (NEKODE-191 U2, U3, U6): four declarations in a fixed order, metric
  // values in reverse order, and 55% only for the subscriptions a manual refresh names.
  writeFileSync(
    join(hubDir, 'index.cjs'),
    `const fs = require('node:fs')
const LABELS = { chatgpt: 'ChatGPT', claude: 'Claude', 'google-ai': 'Google AI', 'opencode-go': 'OpenCode Go' }
const ORDER = ['chatgpt', 'claude', 'google-ai', 'opencode-go']
fs.appendFileSync(${JSON.stringify(pidFile)}, String(process.pid) + '\\n')
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  const respond = (body, code) => { process.stdout.write(JSON.stringify(body)); process.exitCode = code }
  try {
    const request = JSON.parse(input)
    if (request.protocolVersion !== 3 || !['read', 'refresh'].includes(request.action)) throw new Error('request')
    const selected = request.params && request.params.refreshSubscriptions
    fs.appendFileSync(${JSON.stringify(actionsFile)}, JSON.stringify({
      action: request.action,
      connectionId: request.params && request.params.connectionId,
      refreshSubscriptions: selected || null,
    }) + '\\n')
    const ids = selected || ORDER
    const observedAt = new Date().toISOString()
    const metrics = [...ids].reverse().map((id) => ({
      id: id + '-5h',
      label: LABELS[id] + ' 5h',
      subscriptionId: id,
      kind: 'window',
      state: 'available',
      observedAt,
      usedPercent: request.action === 'refresh' ? 55 : 10,
      periodStart: new Date(Date.now() - 3600000).toISOString(),
      resetsAt: '2099-01-01T00:00:00.000Z',
    }))
    const response = {
      protocolVersion: 3,
      ok: true,
      data: {
        schemaVersion: 2,
        reports: [{
          id: request.params.connectionId,
          serviceId: 'fixture-hub',
          label: 'Fixture hub',
          sourceKind: 'api',
          status: 'available',
          subscriptions: ids.map((id) => ({ id, label: LABELS[id] })),
          metrics,
        }],
      },
    }
    if (!selected) response.refreshableSubscriptions = ['chatgpt', 'claude', 'opencode-go']
    respond(response, 0)
  } catch {
    respond({ protocolVersion: 3, ok: false, error: { code: 'protocol', message: 'Invalid fixture input.' } }, 1)
  }
})
`,
  )
  writeFileSync(
    join(hubDir, 'usage-adapter.json'),
    JSON.stringify({
      id: 'fixture-hub',
      name: 'Fixture hub',
      serviceId: 'fixture-hub',
      protocolVersion: 3,
      invocation: { command: process.execPath, args: ['index.cjs'] },
      sourceKind: 'api',
      capabilities: ['window'],
      minimumRefreshSeconds: 60,
      refreshOptions: ['subscriptions'],
      configSchema: [],
    }),
  )
  // U1, U14: a protocol 2 manifest is listed invalid and starts no process.
  writeFileSync(
    join(v2Dir, 'usage-adapter.json'),
    JSON.stringify({
      id: 'legacy-v2',
      name: 'Legacy v2 adapter',
      providerId: 'legacy',
      protocolVersion: 2,
      invocation: {
        command: process.execPath,
        args: [join(v2Dir, 'never-runs.cjs')],
      },
      sourceKind: 'api',
      capabilities: ['window'],
      minimumRefreshSeconds: 300,
      configSchema: [],
    }),
  )
  // The Claude Code adapter runs unchanged against a local fake API (fixture data only).
  // Only a loopback origin is accepted by its NEKODE_USAGE_TEST_BASE_URL seam.
  fakeApi = createHttpServer((request, response) => {
    providerRequests.push({
      method: request.method,
      path: request.url,
      claudeToken:
        request.headers.authorization === `Bearer ${CLAUDE_TOKEN}` &&
        request.headers['anthropic-beta'] === 'oauth-2025-04-20',
    })
    const body =
      request.url === '/api/oauth/usage'
        ? {
            five_hour: {
              utilization: 37,
              resets_at: new Date(Date.now() + 3_600_000).toISOString().replace('Z', '123+00:00'),
            },
            seven_day: {
              utilization: 12,
              resets_at: new Date(Date.now() + 3 * 86_400_000).toISOString().replace('Z', '+00:00'),
            },
          }
        : null
    response.writeHead(body ? 200 : 404, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body ?? {}))
  })
  await new Promise((r) => fakeApi.listen(0, '127.0.0.1', r))
  mkdirSync(claudeConfig, { recursive: true })
  writeFileSync(
    join(claudeConfig, '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: CLAUDE_TOKEN,
        refreshToken: CLAUDE_REFRESH,
        expiresAt: Date.now() + 86_400_000,
      },
    }),
  )
  const claudeCredentials = readFileSync(join(claudeConfig, '.credentials.json'), 'utf8')
  process.env.NEKODE_USAGE_TEST_BASE_URL = `http://127.0.0.1:${fakeApi.address().port}`
  await launch()
  await check(
    'Show usage quota is off at fresh install and hides the title-bar button',
    'window.app.usage.getEnabled().then(e=>e===false&&!document.querySelector(".usage-trigger"))',
  )
  await evaluate('window.app.usage.setEnabled(true)')
  await call('Page.reload')
  await sleep(1000)
  for (
    let n = 0;
    n < 50 && !(await evaluate('Boolean(document.querySelector(".usage-trigger"))'));
    n++
  )
    await sleep(100)
  await check(
    'turning the switch on shows the title-bar button',
    'window.app.usage.getEnabled().then(e=>e===true&&Boolean(document.querySelector(".usage-trigger")))',
  )
  await check(
    'empty usage is neutral and collects nothing',
    'window.app.usage.read().then(s=>s.connections.length===0)',
  )
  await evaluate(
    'document.querySelector(".usage-trigger").focus();document.querySelector(".usage-trigger").click()',
  )
  await check(
    'empty panel has configure action',
    'Boolean([...document.querySelectorAll(".usage-panel button")].find(b=>b.textContent==="Configure usage"))',
  )
  await shot('empty')
  const settings = {
    connections: [
      {
        id: 'hub',
        label: 'PDH',
        serviceId: '',
        adapterId: 'fixture-hub',
        enabled: true,
        config: {},
      },
    ],
    pin: null,
    export: { enabled: true, path: output },
  }
  await evaluate(`window.app.usage.saveSettings(${JSON.stringify(settings)})`)
  // The visible app polls on its own; a scheduled `read` keeps the fixture observation times.
  await waitFor(
    'window.app.usage.read().then(s=>s.connections[0]?.subscription?.metrics.length===4)',
    15000,
  )
  report.initialRead = await evaluate(
    'window.app.usage.read().then(s=>s.connections[0]?.subscription?.subscriptions)',
  )
  await call('Page.reload')
  await sleep(1000)
  await evaluate(
    'document.querySelector(".usage-trigger").focus();document.querySelector(".usage-trigger").click()',
  )
  await waitFor('document.querySelectorAll(".usage-row").length===4', 15000)
  report.headings = await evaluate(
    '[...document.querySelectorAll(".usage-subscription h4")].map(h=>h.textContent)',
  )
  assert.deepEqual(report.headings, ['ChatGPT', 'Claude', 'Google AI', 'OpenCode Go'])
  assert.ok(
    !report.headings.includes('OpenCode') && !report.headings.includes('opencode'),
    'no heading names the reader',
  )
  report.assertions.push(
    'four subscriptions render as headings in declaration order and no heading names a reader',
  )
  report.panelText = await evaluate(
    'document.querySelector(".usage-panel")?.textContent?.slice(0,1500) ?? null',
  )
  await shot('panel-subscriptions')
  const menus = await evaluate(
    '[...document.querySelectorAll(".usage-group-menu")].map(b=>b.getAttribute("aria-label"))',
  )
  for (const label of [
    'Refresh options for PDH',
    'Refresh options for ChatGPT in PDH',
    'Refresh options for Claude in PDH',
    'Refresh options for Google AI in PDH',
    'Refresh options for OpenCode Go in PDH',
  ])
    assert.ok(menus.includes(label), `menu ${label}`)
  report.menus = menus
  report.assertions.push(
    'account and every subscription expose a refresh menu with declared labels',
  )
  // U11: a subscription with no refresh source declares that, and shows a disabled item.
  await evaluate(
    '[...document.querySelectorAll(".usage-group-menu")].find(b=>b.getAttribute("aria-label")==="Refresh options for Google AI in PDH").click()',
  )
  await sleep(100)
  const googleMenu = await evaluate(
    '(()=>{const m=document.querySelector(".usage-menu");return {text:m?.textContent,disabled:m?.querySelector("[role=menuitem]")?.disabled}})()',
  )
  assert.ok(googleMenu.text.includes('No refresh source for this subscription in the Hub'))
  assert.equal(googleMenu.disabled, true)
  report.googleMenu = googleMenu
  await evaluate(
    'document.querySelector(".usage-menu")?.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))',
  )
  report.assertions.push(
    'a subscription without a refresh source shows a disabled subscription reason',
  )
  // A4, A6, U6: the selected subscription refreshes; the other values and observation times stay.
  const before = await evaluate(
    'window.app.usage.read().then(s=>Object.fromEntries(s.connections[0].subscription.metrics.map(m=>[m.id,[m.usedPercent,m.observedAt]])))',
  )
  await evaluate(
    '[...document.querySelectorAll(".usage-group-menu")].find(b=>b.getAttribute("aria-label")==="Refresh options for OpenCode Go in PDH").click()',
  )
  await sleep(100)
  const opencodeMenu = await evaluate(
    '(()=>{const m=document.querySelector(".usage-menu");return {text:m?.textContent,disabled:m?.querySelector("[role=menuitem]")?.disabled}})()',
  )
  assert.ok(opencodeMenu.text.includes('Refresh OpenCode Go in PDH'))
  assert.equal(opencodeMenu.disabled, false)
  await evaluate('document.querySelector(".usage-menu [role=menuitem]").click()')
  await waitFor(
    'document.querySelector("[role=status]")?.textContent.includes("OpenCode Go in PDH refreshed.")',
    15000,
  )
  const after = await evaluate(
    'window.app.usage.read().then(s=>Object.fromEntries(s.connections[0].subscription.metrics.map(m=>[m.id,[m.usedPercent,m.observedAt]])))',
  )
  assert.equal(after['opencode-go-5h'][0], 55)
  assert.notEqual(after['opencode-go-5h'][1], before['opencode-go-5h'][1])
  for (const id of ['chatgpt-5h', 'claude-5h', 'google-ai-5h'])
    assert.deepEqual(after[id], before[id], `${id} keeps value and observation time`)
  report.subscriptionRefresh = { before, after }
  report.assertions.push(
    'a subscription menu refreshes only the selected subscription and leaves the others unchanged',
  )
  const actions = readFileSync(actionsFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const last = actions.at(-1)
  assert.equal(last.action, 'refresh')
  assert.deepEqual(last.refreshSubscriptions, ['opencode-go'])
  report.adapterActions = actions
  report.assertions.push('the adapter request names refreshSubscriptions: ["opencode-go"]')
  // U4: the pinned row and its title-bar meter name the subscription, never the reader.
  await evaluate(
    '[...document.querySelectorAll(".usage-row")].find(r=>r.getAttribute("aria-label").startsWith("PDH, OpenCode Go 5h")).click()',
  )
  await waitFor(
    'document.querySelector(".usage-trigger").textContent.includes("OpenCode Go 5h")',
    10000,
  )
  await evaluate('document.querySelector(".usage-trigger").click()')
  await sleep(200)
  const pinned = await evaluate(
    '(()=>{const r=document.querySelector(".usage-row[aria-pressed=true]");return {text:r?.textContent,trigger:document.querySelector(".usage-trigger").textContent,label:document.querySelector(".usage-trigger").getAttribute("aria-label")}})()',
  )
  assert.ok(pinned.text.includes('OpenCode Go 5h'))
  assert.ok(pinned.label.startsWith('Usage quota: PDH; OpenCode Go 5h;'))
  report.pinned = pinned
  report.assertions.push(
    'the pinned OpenCode Go row and trigger name the subscription, not the reader',
  )
  await evaluate('document.querySelector(\'[aria-label="Close usage panel"]\').click()')
  await shot('toolbar-pinned')
  // U9, acceptance 7: the export is schema 2 with declared subscriptions and no reader name.
  const exported = JSON.parse(readFileSync(output, 'utf8'))
  assert.equal(exported.schemaVersion, 2)
  assert.equal(exported.reports[0].serviceId, 'fixture-hub')
  assert.deepEqual(
    exported.reports[0].subscriptions.map((item) => item.id),
    ['chatgpt', 'claude', 'google-ai', 'opencode-go'],
  )
  const exportedText = JSON.stringify(exported)
  assert.ok(!/providerId|"agents?"|refreshableSubscriptions/.test(exportedText))
  report.export = exported
  report.assertions.push(
    'the JSON export is schema 2 with declared subscriptions and no removed field or reader name',
  )
  // U1, U14: the v2 manifest is listed invalid with the update message and started no process.
  const adapters = await evaluate('window.app.usage.listAdapters()')
  const v2 = adapters.find((adapter) => adapter.directory?.endsWith('legacy-v2'))
  assert.equal(v2?.id, 'invalid:legacy-v2')
  assert.equal(
    v2?.error,
    'This adapter uses protocol version 2. Update it to protocol version 3, which reports subscriptions.',
  )
  report.adapters = adapters
  report.assertions.push(
    'a protocol 2 manifest is listed invalid with the protocol 3 update message',
  )
  await check(
    'shipped Claude Code and Codex adapters are listed without copying, on the NeKode runtime',
    'window.app.usage.listAdapters().then(a=>["claude-code-usage","codex-app-server"].every(id=>{const x=a.find(y=>y.id===id);return x&&x.bundled===true&&!x.error&&/electron|nekode/i.test(x.invocation.command)}))',
  )
  // U10: settings text describes one source reporting several subscriptions.
  await evaluate('document.querySelector(".usage-trigger").click()')
  await sleep(150)
  await evaluate(
    '[...document.querySelectorAll(".usage-panel footer button")].find(b=>b.textContent==="Configure usage").click()',
  )
  const settingsText = await waitFor(
    'Boolean([...document.querySelectorAll("*")].find(e=>e.textContent?.includes("several subscriptions")&&e.children.length===0))',
    10000,
  )
  assert.equal(settingsText, true)
  report.assertions.push(
    'usage settings describe one source reporting one account or several subscriptions',
  )
  await sleep(500)
  await shot('settings-subscriptions')
  await evaluate('document.querySelector(\'[aria-label="Close app settings"]\').click()')
  // U12: the shipped Claude Code adapter reports the Claude subscription through its real process.
  const extra = await evaluate('window.app.usage.getSettings()')
  extra.connections.push({
    id: 'claude-fixture',
    label: 'Claude Code (test data)',
    serviceId: '',
    adapterId: 'claude-code-usage',
    enabled: true,
    config: { configDirectory: claudeConfig },
  })
  await evaluate(`window.app.usage.saveSettings(${JSON.stringify(extra)})`)
  await evaluate('window.app.usage.refresh({connectionId:"claude-fixture"})')
  const claudeOk =
    '(s=>{const c=s.connections.find(x=>x.connection.id==="claude-fixture");const [f,w]=c?.subscription?.metrics??[];return c?.error===null&&f?.id==="five_hour"&&f.subscriptionId==="claude"&&f.label==="Claude 5-hour window"&&f.usedPercent===37&&w?.id==="seven_day"&&w.subscriptionId==="claude"&&w.usedPercent===12&&Date.parse(w.resetsAt)-Date.parse(w.periodStart)===604800000})'
  const claudeValues = `window.app.usage.read().then(${claudeOk})`
  await waitFor(claudeValues, 25000)
  await check('the shipped Claude Code adapter reports the Claude subscription', claudeValues)
  assert.ok(
    providerRequests.some((r) => r.path === '/api/oauth/usage' && r.claudeToken) &&
      providerRequests.every((r) => r.method === 'GET' && r.path === '/api/oauth/usage'),
    'Claude Code sends only the usage GET with its OAuth token and beta header',
  )
  report.providerRequests = providerRequests.map(({ method, path }) => ({ method, path }))
  report.assertions.push(
    'Claude Code sends only the usage GET with its OAuth token and beta header',
  )
  await evaluate(
    '(()=>{if(!document.querySelector(".usage-panel"))document.querySelector(".usage-trigger").click()})()',
  )
  const claudeRows =
    '(()=>{const t=document.querySelector(".usage-panel")?.textContent??"";return t.includes("Claude 5-hour window")&&t.includes("37%")&&t.includes("Claude 7-day window")&&t.includes("12%")})()'
  await waitFor(claudeRows, 15000)
  report.panelProviders = await evaluate(
    'document.querySelector(".usage-panel")?.textContent?.slice(0,2000) ?? null',
  )
  await check('the panel shows the Claude subscription rows', claudeRows)
  await shot('panel-claude')
  await evaluate('document.querySelector(\'[aria-label="Close usage panel"]\').click()')
  await close()
  // Claude Code credentials must not enter export, cache or the database.
  const leaked = [output, join(profile, 'usage', 'observations.json')]
  for (const name of readdirSync(profile)) {
    const path = join(profile, name)
    if (/\.(db|sqlite|sqlite3)(-wal|-shm)?$/i.test(name)) leaked.push(path)
  }
  const found = leaked.filter((path) =>
    [Buffer.from(CLAUDE_TOKEN), Buffer.from(CLAUDE_REFRESH)].some((secret) =>
      readFileSync(path).includes(secret),
    ),
  )
  assert.deepEqual(found, [], 'no Claude Code tokens in export, cache or database files')
  assert.equal(
    readFileSync(join(claudeConfig, '.credentials.json'), 'utf8'),
    claudeCredentials,
    'the Claude Code credentials file is unchanged',
  )
  report.assertions.push('Claude Code tokens absent and credentials file unchanged')
  const pids = readFileSync(pidFile, 'utf8').trim().split(/\s+/).map(Number)
  for (const pid of pids) {
    let alive = true
    try {
      process.kill(pid, 0)
    } catch {
      alive = false
    }
    assert.equal(alive, false, `fixture adapter ${pid} reaped`)
  }
  report.cleanup.adapterPids = pids
  report.cleanup.adaptersReaped = true
  for (const pid of electronPids) {
    let alive = true
    try {
      process.kill(pid, 0)
    } catch {
      alive = false
    }
    assert.equal(alive, false, `captured Electron process ${pid} reaped`)
  }
  report.cleanup.electronPids = [...electronPids]
  report.cleanup.electronTreeReaped = true
  report.limitations = [
    'Live provider/account reads were not run; every observation is fixture data.',
    'The installed Personal Data Hub adapter and the live Hub read need the NeKode token from PDH-47 and stay not run.',
    'Isolated scratch files are retained for review; no real user data was read.',
  ]
} catch (error) {
  report.error = error.stack
  process.exitCode = 1
} finally {
  if (child) {
    try {
      await close()
    } catch (error) {
      report.cleanup.error = String(error)
      process.exitCode = 1
    }
  }
  inspectorSocket?.close()
  pageSocket?.close()
  browserSocket?.close()
  fakeApi?.close()
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
