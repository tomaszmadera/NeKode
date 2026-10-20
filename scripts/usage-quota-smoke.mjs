// Windows Electron smoke with an isolated profile and fixture-only quota data.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
  pidFile = join(scratch, 'adapter-pids.txt')
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
let child, browserSocket, pageSocket, inspectorSocket, call, mainCall, browserCall
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
        'typeof window.app?.usage?.read === "function" && Boolean(document.querySelector(".usage-trigger"))',
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
// Manual refresh obeys the adapter minimum interval (spec rule 13), so a read that
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
        sourceKind: 'file',
        status: 'available',
        metrics,
      },
    ],
  }
  writeFileSync(input, JSON.stringify(doc))
  writeFileSync(
    join(adapterDir, 'index.cjs'),
    `require('node:fs').appendFileSync(${JSON.stringify(pidFile)},String(process.pid)+'\\n');require(${JSON.stringify(join(root, 'adapters', 'usage-file', 'index.cjs'))})`,
  )
  const manifest = JSON.parse(
    readFileSync(join(root, 'adapters', 'usage-file', 'usage-adapter.json'), 'utf8'),
  )
  manifest.invocation.command = process.execPath
  writeFileSync(join(adapterDir, 'usage-adapter.json'), JSON.stringify(manifest))
  await launch()
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
    adaptersDirectory: null,
    export: { enabled: true, path: output },
  }
  await evaluate(`window.app.usage.saveSettings(${JSON.stringify(settings)})`)
  await evaluate('window.app.usage.refresh()')
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
  await evaluate('document.querySelectorAll(".usage-row")[1].click()')
  await sleep(250)
  await check(
    'only selected row is pinned',
    'document.querySelector(".usage-row[aria-pressed=true]")?.textContent.includes("7d")===true && document.querySelector(".usage-trigger").textContent.includes("47%")',
  )
  await shot('panel-default')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await check(
    'Escape closes and restores trigger focus',
    '!document.querySelector(".usage-panel") && document.activeElement===document.querySelector(".usage-trigger")',
  )
  await shot('toolbar-pinned')
  // Use React's actual settings event, so both layout and theme tokens update.
  for (const theme of ['nekode-float', 'nekode-float-v2']) {
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
  await launch()
  await sleep(500)
  await check(
    'pin and real observation timestamp persist after restart',
    '(()=>{return window.app.usage.read().then(s=>s.pin?.metricId==="week"&&s.connections[0].subscription.metrics.find(m=>m.id==="short").observedAt===' +
      JSON.stringify(metrics[0].observedAt) +
      ')})()',
  )
  await sleep(5200)
  writeFileSync(input, '{')
  await evaluate('window.app.usage.refresh()')
  // A malformed local file is transient (spec rule 13): the process adapter reports protocol.
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
  // Exercise the built-in source's actual automatic scheduler, without an explicit retry.
  writeFileSync(input, JSON.stringify(doc))
  const builtIn = await evaluate('window.app.usage.getSettings()')
  builtIn.connections[0].adapterId = 'usage-file'
  await evaluate(`window.app.usage.saveSettings(${JSON.stringify(builtIn)})`)
  await evaluate('window.app.usage.refresh()')
  await sleep(5200)
  writeFileSync(input, '{')
  await evaluate('window.app.usage.refresh()')
  const protocolFailure =
    'window.app.usage.read().then(s=>s.connections[0].error?.code==="protocol"&&s.connections[0].subscription.metrics.find(m=>m.id==="week").usedPercent===47)'
  await waitFor(protocolFailure, 7000)
  await check(
    'built-in partial JSON reports protocol error and retains accepted values',
    protocolFailure,
  )
  doc.subscriptions[0].metrics.find((m) => m.id === 'week').usedPercent = 48
  doc.subscriptions[0].metrics.find((m) => m.id === 'week').observedAt = new Date().toISOString()
  writeFileSync(input, JSON.stringify(doc))
  // Local file sources retry every 5 seconds without growing backoff; allow one scheduler
  // tick and IPC latency on top of that cadence.
  const recoveryStarted = Date.now()
  for (let n = 0; n < 24; n++) {
    if (
      await evaluate(
        'window.app.usage.read().then(s=>s.connections[0].error===null&&s.connections[0].subscription.metrics.find(m=>m.id==="week").usedPercent===48)',
      )
    )
      break
    await sleep(500)
  }
  report.automaticRecoveryMs = Date.now() - recoveryStarted
  assert.ok(
    report.automaticRecoveryMs <= 8000,
    `file source recovered at the 5-second cadence (${report.automaticRecoveryMs} ms)`,
  )
  await check(
    'repaired partial JSON recovers automatically at the 5-second file cadence without Refresh',
    'window.app.usage.read().then(s=>s.connections[0].error===null&&s.connections[0].subscription.metrics.find(m=>m.id==="week").usedPercent===48)',
  )
  await close()
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
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
