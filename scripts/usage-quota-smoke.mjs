// Windows Electron smoke with an isolated profile and fixture-only quota data.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const evidence = join(root, 'tmp', 'nekode-90-stage1-smoke')
mkdirSync(evidence, { recursive: true })
const scratch = mkdtempSync(join(tmpdir(), 'nekode-usage-smoke-'))
const profile = join(scratch, 'profile'),
  input = join(scratch, 'input.json'),
  output = join(scratch, 'export.json')
const adapterDir = join(profile, 'usage-adapters', 'fixture'),
  pidFile = join(scratch, 'adapter-pids.txt'),
  actionsFile = join(scratch, 'adapter-actions.txt')
mkdirSync(adapterDir, { recursive: true })
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
const PROVIDER_KEY = 'fixture-provider-key-not-a-real-secret'
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
// A manual refresh starts at most once per 60 seconds per account (spec L5), so a read that
// follows an automatic poll may be deferred to the next due tick; wait for that tick.
async function waitFor(expression, timeoutMs) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end && !(await evaluate(expression))) await sleep(250)
}
async function check(name, expression) {
  const result = await evaluate(expression)
  assert.equal(result, true, name)
  report.assertions.push(name)
}
async function shot(name) {
  await call('Page.bringToFront')
  await sleep(1500)
  await call('Page.captureScreenshot', { format: 'png' })
  await sleep(1000)
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
  const now = Date.now(),
    iso = (ms) => new Date(ms).toISOString(),
    day = 86400000,
    date = new Date(now)
  const metrics = [
    {
      id: 'short',
      label: '5h',
      kind: 'window',
      usedPercent: 14,
      observedAt: iso(now - 90 * 60000),
      periodStart: iso(now - 2 * 3600000),
      resetsAt: iso(now + 3 * 3600000),
    },
    {
      id: 'week',
      label: '7d',
      kind: 'window',
      usedPercent: 47,
      observedAt: iso(now - 60000),
      periodStart: iso(now - 3 * day),
      resetsAt: iso(now + 4 * day),
    },
    {
      id: 'month',
      label: 'Monthly',
      kind: 'credits',
      used: 900,
      limit: 2000,
      unit: 'characters',
      observedAt: iso(now - 60000),
      periodStart: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString(),
      resetsAt: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString(),
    },
    {
      id: 'balance',
      label: 'Balance',
      kind: 'balance',
      amount: 12.55,
      currency: 'USD',
      observedAt: null,
    },
  ].map((m) => ({ ...m, state: 'available' }))
  const doc = {
    schemaVersion: 1,
    subscriptions: [
      {
        id: 'fixture-account',
        providerId: 'fixture',
        label: 'Fixture subscription',
        sourceKind: 'api',
        status: 'available',
        metrics,
      },
    ],
  }
  writeFileSync(input, JSON.stringify(doc))
  // A user adapter speaking protocol 2 (spec L1-L2): `read` returns the fixture file as written,
  // `refresh` stamps every available value with the response time, as a live provider read does.
  writeFileSync(
    join(adapterDir, 'index.cjs'),
    `const fs = require('node:fs')
fs.appendFileSync(${JSON.stringify(pidFile)}, String(process.pid) + '\\n')
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  const respond = (body, code) => { process.stdout.write(JSON.stringify(body)); process.exitCode = code }
  try {
    const request = JSON.parse(input)
    if (request.protocolVersion !== 2 || !['read', 'refresh'].includes(request.action)) throw new Error('request')
    fs.appendFileSync(${JSON.stringify(actionsFile)}, request.action + '\\n')
    const data = JSON.parse(fs.readFileSync(request.config.path, 'utf8'))
    if (request.action === 'refresh') {
      const at = new Date().toISOString()
      for (const s of data.subscriptions) for (const m of s.metrics) if (m.state === 'available') m.observedAt = at
    }
    respond({ protocolVersion: 2, ok: true, data }, 0)
  } catch {
    respond({ protocolVersion: 2, ok: false, error: { code: 'protocol', message: 'Invalid fixture input.' } }, 1)
  }
})
`,
  )
  const manifest = {
    id: 'fixture-process',
    name: 'Fixture process adapter',
    protocolVersion: 2,
    invocation: { command: process.execPath, args: ['index.cjs'] },
    sourceKind: 'api',
    capabilities: ['window', 'credits', 'balance'],
    minimumRefreshSeconds: 300,
    configSchema: [{ key: 'path', label: 'Fixture input file', type: 'file', required: true }],
  }
  writeFileSync(join(adapterDir, 'usage-adapter.json'), JSON.stringify(manifest))
  // Stage 3 provider adapters run unchanged against a local fake API (fixture data only). Only a
  // loopback origin is accepted by their NEKODE_USAGE_TEST_BASE_URL seam.
  fakeApi = createHttpServer((request, response) => {
    providerRequests.push({
      method: request.method,
      path: request.url,
      elevenlabsKey: request.headers['xi-api-key'] === PROVIDER_KEY,
      bearerKey: request.headers.authorization === `Bearer ${PROVIDER_KEY}`,
      claudeToken:
        request.headers.authorization === `Bearer ${CLAUDE_TOKEN}` &&
        request.headers['anthropic-beta'] === 'oauth-2025-04-20',
    })
    const body =
      request.url === '/v1/user/subscription'
        ? {
            tier: 'fixture',
            character_count: 25000,
            character_limit: 100000,
            next_character_count_reset_unix: Math.floor(now / 1000) + 10 * 86400,
            billing_period: 'monthly_period',
          }
        : request.url === '/api/v1/credits'
          ? { data: { total_credits: 10, total_usage: 12.5 } }
          : request.url === '/api/oauth/usage'
            ? {
                five_hour: {
                  utilization: 37,
                  resets_at: new Date(now + 3_600_000).toISOString().replace('Z', '123+00:00'),
                },
                seven_day: {
                  utilization: 12,
                  resets_at: new Date(now + 3 * 86_400_000).toISOString().replace('Z', '+00:00'),
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
        expiresAt: now + 86_400_000,
      },
    }),
  )
  const claudeCredentials = readFileSync(join(claudeConfig, '.credentials.json'), 'utf8')
  process.env.NEKODE_USAGE_TEST_BASE_URL = `http://127.0.0.1:${fakeApi.address().port}`
  // The ElevenLabs and OpenRouter adapters are the shipped ones (usage-quota spec rule 17): the
  // unpackaged app reads them from adapters/ and runs them on Electron in Node mode (rule 19).
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
        id: 'fixture-account',
        label: 'Fixture subscription (test data)',
        providerId: 'fixture',
        adapterId: manifest.id,
        enabled: true,
        config: { path: input },
      },
    ],
    pin: null,
    export: { enabled: true, path: output },
  }
  await evaluate(`window.app.usage.saveSettings(${JSON.stringify(settings)})`)
  // The visible app polls on its own; a scheduled `read` keeps the fixture observation times.
  await waitFor('window.app.usage.read().then(s=>Boolean(s.connections[0]?.subscription))', 10000)
  await call('Page.reload')
  await sleep(1000)
  await evaluate(
    'document.querySelector(".usage-trigger").focus();document.querySelector(".usage-trigger").click()',
  )
  report.initialPopulatedRead = {
    at: Date.now(),
    rows: await evaluate('document.querySelectorAll(".usage-row").length'),
    mainMetrics: await evaluate(
      'window.app.usage.read().then(s=>s.connections[0]?.subscription?.metrics.length)',
    ),
    document: await evaluate(
      '({hidden:document.hidden, visibility:document.visibilityState, readyState:document.readyState})',
    ),
    toolbar: await evaluate(
      '(()=>{let f=document.querySelector(".usage-trigger")[Object.keys(document.querySelector(".usage-trigger")).find(k=>k.startsWith("__reactFiber"))];while(f&&f.type?.name!=="UsageToolbar")f=f.return;return f?.memoizedState?.memoizedState})()',
    ),
  }
  for (
    let n = 0;
    n < 60 && !(await evaluate('document.querySelectorAll(".usage-row").length===4'));
    n++
  )
    await sleep(100)
  report.populatedReadyDelayMs = Date.now() - report.initialPopulatedRead.at
  await check(
    'four actual fixture metrics render, including balance and old age',
    'document.querySelectorAll(".usage-row").length===4 && document.querySelector(".usage-panel").textContent.includes("USD 12.55") && document.querySelector(".usage-panel").textContent.includes("Stale - 1h 30m old")',
  )
  report.regions = await evaluate(
    '({focusInside: Boolean(document.querySelector(".usage-panel").contains(document.activeElement)), active:document.activeElement?.outerHTML, firstButton:document.querySelector(".usage-panel button").outerHTML,title:getComputedStyle(document.querySelector("[data-testid=title-bar]")).webkitAppRegion,trigger:getComputedStyle(document.querySelector(".usage-trigger")).webkitAppRegion})',
  )
  await check(
    'focus enters panel and drag regions remain separated',
    'Boolean(document.querySelector(".usage-panel").contains(document.activeElement)) && getComputedStyle(document.querySelector("[data-testid=title-bar]")).webkitAppRegion==="drag" && getComputedStyle(document.querySelector(".usage-trigger")).webkitAppRegion==="no-drag"',
  )
  const layout = await evaluate(
    '(()=>{const p=document.querySelector(".usage-panel").getBoundingClientRect(),b=document.querySelector(".usage-trigger").getBoundingClientRect();return {width:p.width,gap:p.top-b.bottom,left:p.left,right:p.right,viewport:innerWidth,titleHeight:document.querySelector("[data-testid=title-bar]").getBoundingClientRect().height,rowHeight:document.querySelector(".usage-row").getBoundingClientRect().height}})()',
  )
  assert.equal(layout.width, 400)
  assert.equal(layout.gap, 6)
  assert.equal(layout.titleHeight, 40)
  assert.ok(layout.rowHeight <= 34)
  report.layout = layout
  const snapshot = await evaluate('window.app.usage.read()')
  assert.deepEqual(
    JSON.parse(readFileSync(output, 'utf8')).subscriptions[0],
    snapshot.connections[0].subscription,
  )
  report.assertions.push(
    'export equals the normalized accepted subscription, without configuration or secrets',
  )
  await shot('panel-default')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await check(
    'Escape closes and restores trigger focus',
    '!document.querySelector(".usage-panel") && document.activeElement===document.querySelector(".usage-trigger")',
  )
  // Choosing a row pins it and closes the panel (NEKODE-121); reopen it to inspect the rows.
  await evaluate('document.querySelector(".usage-trigger").click()')
  await sleep(100)
  await evaluate('document.querySelectorAll(".usage-row")[1].click()')
  await sleep(250)
  await evaluate('document.querySelector(".usage-trigger").click()')
  await sleep(100)
  await check(
    'only selected row is pinned',
    'document.querySelector(".usage-row[aria-pressed=true]")?.textContent.includes("7d")===true && document.querySelector(".usage-trigger").textContent.includes("47%")',
  )
  await evaluate(`document.querySelector('[aria-label="Close usage panel"]').click()`)
  await shot('toolbar-pinned')
  // Use React's actual settings event, so both layout and theme tokens update.
  for (const theme of ['nekode-float']) {
    await evaluate('document.querySelector("[data-testid=app-settings-button]").click()')
    await sleep(100)
    await evaluate(
      `(()=>{const e=document.querySelector('#app-theme');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(e,${JSON.stringify(theme)});e.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[aria-label="Close app settings"]').click()})()`,
    )
    await sleep(150)
    await evaluate('document.querySelector(".usage-trigger").click()')
    await check(
      `${theme} preserves all quota graphics`,
      'document.querySelectorAll(".usage-row .usage-graphic").length===3 && [...document.querySelectorAll(".usage-row .usage-graphic")].every(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0)',
    )
    await shot(`panel-${theme}`)
    await evaluate(`document.querySelector('[aria-label="Close usage panel"]').click()`)
  }
  await call('Emulation.setDeviceMetricsOverride', {
    width: 360,
    height: 640,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await evaluate('document.querySelector(".usage-trigger").click()')
  await sleep(100)
  await check(
    'narrow panel remains inside viewport and retains every metric',
    '(()=>{const r=document.querySelector(".usage-panel").getBoundingClientRect();return r.left>=12&&r.right<=innerWidth-12&&document.querySelectorAll(".usage-row").length===4})()',
  )
  await shot('panel-narrow')
  await call('Emulation.clearDeviceMetricsOverride')
  // Native window APIs verify minimize/restore/maximize without accessing the real user profile.
  const native = 'process.mainModule.require("electron").BrowserWindow.getAllWindows()[0]'
  report.native = await evaluate(
    `(()=>{const w=${native};return {minimizable:w.isMinimizable(),maximizable:w.isMaximizable(),closable:w.isClosable(),movable:w.isMovable(),bounds:w.getBounds()}})()`,
    true,
  )
  assert.ok(
    report.native.minimizable &&
      report.native.maximizable &&
      report.native.closable &&
      report.native.movable,
  )
  await evaluate(`${native}.minimize();true`, true)
  await sleep(150)
  assert.equal(await evaluate(`${native}.isMinimized()`, true), true)
  await evaluate(`${native}.restore();${native}.maximize();true`, true)
  await sleep(150)
  assert.equal(await evaluate(`${native}.isMaximized()`, true), true)
  await evaluate(`${native}.unmaximize();true`, true)
  report.assertions.push(
    'native window minimize, restore and maximize remain functional; drag/no-drag regions retain their computed ownership',
  )
  await close()
  // The scheduled read at the next launch fails on this malformed input (protocol).
  writeFileSync(input, '{')
  await launch()
  await sleep(500)
  await check(
    'pin and real observation timestamp persist after restart',
    '(()=>{return window.app.usage.read().then(s=>s.pin?.metricId==="week"&&s.connections[0].subscription.metrics.find(m=>m.id==="short").observedAt===' +
      JSON.stringify(metrics[0].observedAt) +
      ')})()',
  )
  const pluginFailure =
    'window.app.usage.read().then(s=>s.pin?.metricId==="week"&&s.connections[0].error?.code==="protocol"&&s.connections[0].subscription.metrics.find(m=>m.id==="week").usedPercent===47)'
  await waitFor(pluginFailure, 7000)
  await check('failed read retains pin and last successful value', pluginFailure)
  await evaluate('document.querySelector(".usage-trigger").click()')
  for (
    let n = 0;
    n < 70 &&
    !(await evaluate(
      'document.querySelector(".usage-source-note")?.textContent.includes("source protocol")',
    ));
    n++
  )
    await sleep(100)
  await check(
    'renderer exposes the cached source error',
    'document.querySelector(".usage-source-note")?.textContent.includes("source protocol")===true && document.querySelector(".usage-trigger").textContent.includes("Error")',
  )
  await shot('panel-error-cached')
  // Spec L5: a manual refresh reads 60 seconds after the last read although the adapter
  // minimum is 300 seconds, sends `refresh`, and reports an interval skip inside 60 seconds.
  doc.subscriptions[0].metrics.find((m) => m.id === 'week').usedPercent = 48
  writeFileSync(input, JSON.stringify(doc))
  const nextRefreshAt = await evaluate(
    'window.app.usage.read().then(s=>s.connections[0].nextRefreshAt)',
  )
  assert.ok(nextRefreshAt, 'a manual refresh waits after the failed scheduled read')
  report.manualRefresh = { nextRefreshAt }
  await check(
    'a manual refresh inside the 60-second limit is skipped as interval',
    'window.app.usage.refresh().then(s=>s.refresh.read.length===0&&s.refresh.skipped[0]?.reason==="interval"&&s.refresh.skipped[0]?.connectionId==="fixture-account")',
  )
  const waitMs = Date.parse(nextRefreshAt) - Date.now() + 1000
  if (waitMs > 0) await sleep(waitMs)
  report.manualRefresh.at = new Date().toISOString()
  await check(
    'a manual refresh 60 seconds after the last read sends refresh inside the 300-second adapter interval',
    'window.app.usage.refresh().then(s=>s.refresh.read.includes("fixture-account")&&s.connections[0].error===null&&s.connections[0].subscription.metrics.find(m=>m.id==="week").usedPercent===48)',
  )
  const actions = readFileSync(actionsFile, 'utf8').trim().split(/\s+/)
  assert.equal(actions.at(-1), 'refresh', 'the manual read used the refresh action')
  assert.ok(
    actions.slice(0, -1).every((a) => a === 'read'),
    'scheduled reads used the read action',
  )
  report.manualRefresh.actions = actions
  report.assertions.push('scheduled reads send read and the manual read sends refresh')
  await check(
    'an immediate second manual refresh is skipped as interval',
    'window.app.usage.refresh().then(s=>s.refresh.read.length===0&&s.refresh.skipped[0]?.reason==="interval")',
  )
  await check(
    'OpenRouter adapter lists its Management key privilege explanation',
    'window.app.usage.listAdapters().then(a=>a.find(x=>x.id==="openrouter-credits")?.description?.includes("Management key")===true&&!a.find(x=>x.id==="elevenlabs-subscription")?.error)',
  )
  await check(
    'shipped Claude Code, Codex, ElevenLabs and OpenRouter adapters are listed without copying, on the NeKode runtime',
    'window.app.usage.listAdapters().then(a=>["claude-code-usage","codex-app-server","elevenlabs-subscription","openrouter-credits"].every(id=>{const x=a.find(y=>y.id===id);return x&&x.bundled===true&&!x.error&&/electron|nekode/i.test(x.invocation.command)}))',
  )
  const providers = await evaluate('window.app.usage.getSettings()')
  providers.connections.push(
    {
      id: 'elevenlabs-fixture',
      label: 'ElevenLabs (test data)',
      providerId: 'elevenlabs',
      adapterId: 'elevenlabs-subscription',
      enabled: true,
      config: { apiKey: PROVIDER_KEY },
    },
    {
      id: 'openrouter-fixture',
      label: 'OpenRouter (test data)',
      providerId: 'openrouter',
      adapterId: 'openrouter-credits',
      enabled: true,
      config: { apiKey: PROVIDER_KEY },
    },
    {
      id: 'claude-fixture',
      label: 'Claude Code (test data)',
      providerId: 'claude',
      adapterId: 'claude-code-usage',
      enabled: true,
      config: { configDirectory: claudeConfig },
    },
  )
  await evaluate(`window.app.usage.saveSettings(${JSON.stringify(providers)})`)
  await evaluate('window.app.usage.refresh()')
  // Claude Code (spec L13): both windows with periods; the 7-day window has a 7-day period.
  const claudeOk =
    '(s=>{const c=s.connections.find(x=>x.connection.id==="claude-fixture");const [f,w]=c?.subscription?.metrics??[];return c?.error===null&&f?.id==="five_hour"&&f.usedPercent===37&&f.resetsAt?.length===24&&w?.id==="seven_day"&&w.usedPercent===12&&Date.parse(w.resetsAt)-Date.parse(w.periodStart)===604800000})'
  const providerValues =
    'window.app.usage.read().then(s=>{const e=s.connections.find(c=>c.connection.id==="elevenlabs-fixture"),o=s.connections.find(c=>c.connection.id==="openrouter-fixture");const m=e?.subscription?.metrics[0],b=o?.subscription?.metrics[0];return e?.error===null&&o?.error===null&&m?.kind==="credits"&&m.used===25000&&m.limit===100000&&m.unit==="characters"&&b?.kind==="balance"&&b.amount===-2.5&&b.currency==="USD"&&' +
    claudeOk +
    '(s)})'
  await waitFor(providerValues, 25000)
  await check(
    'ElevenLabs credits, negative OpenRouter USD balance and Claude Code windows load through the real adapters',
    providerValues,
  )
  assert.ok(
    providerRequests.some((r) => r.path === '/v1/user/subscription' && r.elevenlabsKey) &&
      providerRequests.some((r) => r.path === '/api/v1/credits' && r.bearerKey) &&
      providerRequests.some((r) => r.path === '/api/oauth/usage' && r.claudeToken) &&
      providerRequests.every(
        (r) =>
          r.method === 'GET' &&
          ['/v1/user/subscription', '/api/v1/credits', '/api/oauth/usage'].includes(r.path),
      ),
    'provider adapters send only the documented GETs with the key in the header',
  )
  report.assertions.push(
    'provider adapters send only the documented metadata GETs with the key in the header',
  )
  report.providerRequests = providerRequests.map(({ method, path }) => ({ method, path }))
  // Open the panel only when closed, then allow one renderer read interval (5 seconds).
  await evaluate(
    '(()=>{if(!document.querySelector(".usage-panel"))document.querySelector(".usage-trigger").click()})()',
  )
  const providerRows =
    '(()=>{const t=document.querySelector(".usage-panel")?.textContent??"";return t.includes("25%")&&t.includes("USD -2.50")})()'
  await waitFor(providerRows, 10000)
  report.providerPanelText = await evaluate(
    'document.querySelector(".usage-panel")?.textContent?.slice(0,2000) ?? null',
  )
  await check('panel shows the provider rows', providerRows)
  await shot('panel-providers')
  await evaluate(`document.querySelector('[aria-label="Close usage panel"]').click()`)
  await check(
    'settings expose only secret presence for provider keys',
    `window.app.usage.getSettings().then(s=>{const t=JSON.stringify(s);return !t.includes(${JSON.stringify(PROVIDER_KEY)})&&s.connections.filter(c=>c.secretKeys?.includes("apiKey")).length===2})`,
  )
  await close()
  // Acceptance 13: the key is stored encrypted and absent from export, cache and the database.
  const plaintext = Buffer.from(PROVIDER_KEY)
  const leaked = [output, join(profile, 'usage', 'observations.json')]
  for (const name of readdirSync(profile)) {
    const path = join(profile, name)
    if (/\.(db|sqlite|sqlite3)(-wal|-shm)?$/i.test(name)) leaked.push(path)
  }
  const found = leaked.filter((path) =>
    [plaintext, Buffer.from(CLAUDE_TOKEN), Buffer.from(CLAUDE_REFRESH)].some((secret) =>
      readFileSync(path).includes(secret),
    ),
  )
  assert.deepEqual(found, [], 'no plaintext provider key in export, cache or database files')
  assert.equal(
    readFileSync(join(claudeConfig, '.credentials.json'), 'utf8'),
    claudeCredentials,
    'the Claude Code credentials file is unchanged',
  )
  report.assertions.push('Claude Code tokens absent and credentials file unchanged')
  report.assertions.push(
    `no plaintext provider key in export, cache or database files (${leaked.length} files checked)`,
  )
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
    'Native caption API states and drag CSS boundaries were exercised. Physical mouse dragging and clicking the OS-drawn caption buttons were not injected by CDP.',
    'Live provider/account reads were not run; all observations are fixture data.',
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
