import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const runner = fileURLToPath(new URL('./test.mjs', import.meta.url))

test('test script preserves file selection, full runs and failure exits', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'nekode-test-runner-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const config = join(root, 'vitest.config.mjs')
  writeFileSync(config, 'export default { test: { globals: true, include: ["*.test.js"] } }')
  writeFileSync(join(root, 'selected.test.js'), 'test("selected", () => expect(1).toBe(1))')
  writeFileSync(join(root, 'other.test.js'), 'test("other", () => expect(2).toBe(2))')
  let attempt = 0
  const run = (...args) => {
    const output = join(root, `result-${++attempt}.json`)
    const result = spawnSync(
      process.execPath,
      [
        runner,
        ...args,
        '--root',
        root,
        '--config',
        config,
        '--reporter=json',
        '--outputFile',
        output,
      ],
      { cwd: root, encoding: 'utf8', timeout: 30_000 },
    )
    assert.ifError(result.error)
    return { ...result, report: () => JSON.parse(readFileSync(output, 'utf8')) }
  }
  for (const args of [['selected.test.js'], ['--', 'selected.test.js']]) {
    const result = run(...args)
    assert.equal(result.status, 0, result.stderr)
    const report = result.report()
    assert.equal(report.numTotalTests, 1)
    assert.equal(report.testResults.length, 1)
    assert.equal(report.testResults[0].name, join(root, 'selected.test.js').replaceAll('\\', '/'))
  }
  const full = run()
  assert.equal(full.status, 0, full.stderr)
  assert.equal(full.report().numTotalTests, 2)

  writeFileSync(join(root, 'failure.test.js'), 'test("failure", () => expect(1).toBe(2))')
  const failed = run('--', 'failure.test.js')
  assert.equal(failed.status, 1, failed.stderr)
  assert.equal(failed.report().numFailedTests, 1)

  const missing = run('--', 'missing.test.js')
  assert.equal(missing.status, 1, missing.stderr)
})
