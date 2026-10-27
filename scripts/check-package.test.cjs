const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  statSync,
  writeFileSync,
} = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const { test } = require('node:test')
const { createPackageWithOptions } = require('@electron/asar')
const { checkPackage } = require('./check-package.cjs')

const required = [
  'package.json',
  'out/main/index.js',
  'out/preload/index.js',
  'out/renderer/index.html',
  'node_modules/better-sqlite3/package.json',
  'node_modules/better-sqlite3/lib/index.js',
  'node_modules/node-pty/package.json',
  'node_modules/node-pty/lib/index.js',
  `node_modules/better-sqlite3/prebuilds/${process.platform}-x64.node`,
  ...(process.platform === 'win32'
    ? [
        'node_modules/node-pty/prebuilds/win32-x64/conpty.node',
        'node_modules/node-pty/prebuilds/win32-x64/conpty_console_list.node',
      ]
    : ['node_modules/node-pty/build/Release/pty.node']),
]

async function fixture(t, extras = [], omit) {
  const scratch = mkdtempSync(join(tmpdir(), 'nekode-package-test-'))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const input = join(scratch, 'input')
  mkdirSync(input)
  for (const name of [...required.filter((path) => path !== omit), ...extras]) {
    const target = join(input, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, name.endsWith('package.json') ? '{}' : 'fixture')
  }
  const archive = join(scratch, 'app.asar')
  await createPackageWithOptions(input, archive, { unpack: '**/*.node' })
  return archive
}

test('accepts compiled output and native dependency sources', async (t) => {
  const archive = await fixture(t, ['node_modules/node-pty/src/unix/pty.cc'])
  assert.equal(checkPackage(archive).files, required.length + 1)
})

for (const root of ['.agents', '.claude', '.codex', '.grok', '.opencode', 'src', 'docs', 'tmp']) {
  test(`rejects ${root} from archive metadata`, async (t) => {
    const archive = await fixture(t, [`${root}/fixture.txt`])
    assert.throws(() => checkPackage(archive), /Forbidden package content/)
  })
}

for (const path of [
  '.env',
  '.agents/.env',
  'out/.env.local',
  'node_modules/example/.env',
  'pnpm-lock.yaml',
  'tsconfig.node.tsbuildinfo',
]) {
  test(`rejects ${path}`, async (t) => {
    const archive = await fixture(t, [path])
    assert.throws(() => checkPackage(archive), /Forbidden package content/)
  })
}

test('rejects each missing required file', async (t) => {
  for (const path of required) {
    const archive = await fixture(t, [], path)
    assert.throws(
      () => checkPackage(archive),
      /Missing or empty required package file|Missing unpacked native package binary/,
    )
  }
})

test('afterPack hook checks the archive in the target output directory', async (t) => {
  const archive = await fixture(t)
  const appOutDir = join(dirname(archive), 'win-unpacked')
  mkdirSync(join(appOutDir, 'resources'), { recursive: true })
  copyFileSync(archive, join(appOutDir, 'resources/app.asar'))
  cpSync(`${archive}.unpacked`, join(appOutDir, 'resources/app.asar.unpacked'), { recursive: true })
  const context = { appOutDir, arch: 1, electronPlatformName: process.platform }
  assert.equal(require('./check-package.cjs')(context).files, required.length)
  const forbidden = await fixture(t, ['.agents/.env'])
  copyFileSync(forbidden, join(appOutDir, 'resources/app.asar'))
  assert.throws(() => require('./check-package.cjs')(context), /Forbidden package content/)
})

test('rejects native binaries missing from the unpacked directory', async (t) => {
  const archive = await fixture(t)
  const native = required.find((path) => path.endsWith('.node'))
  rmSync(join(`${archive}.unpacked`, native))
  assert.throws(() => checkPackage(archive), /ENOENT/)
})

test('rejects a truncated payload even when its header is intact', async (t) => {
  const archive = await fixture(t)
  truncateSync(archive, statSync(archive).size - 1)
  assert.throws(() => checkPackage(archive), /Invalid or truncated package payload/)
})

test('CLI fails for missing and malformed archives and missing arguments', (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'nekode-package-cli-'))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const malformed = join(scratch, 'bad.asar')
  writeFileSync(malformed, 'invalid')
  for (const args of [[], [join(scratch, 'missing.asar')], [malformed]]) {
    const result = spawnSync(process.execPath, [join(__dirname, 'check-package.cjs'), ...args], {
      encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Package content check failed/)
  }
})
