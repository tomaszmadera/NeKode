import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { expandScript } from './verify.mjs'

const verify = fileURLToPath(new URL('./verify.mjs', import.meta.url))

test('expands nested pnpm run steps in order and keeps other steps', () => {
  const scripts = {
    lint: 'biome check .',
    'typecheck:node': 'tsc -p a.json',
    'typecheck:web': 'tsc -p b.json',
    typecheck: 'pnpm run typecheck:node && pnpm run typecheck:web',
    verify: 'pnpm run lint && pnpm run typecheck && node scripts/test.mjs',
  }
  assert.deepEqual(expandScript(scripts, 'verify'), [
    'biome check .',
    'tsc -p a.json',
    'tsc -p b.json',
    'node scripts/test.mjs',
  ])
})

test('rejects an unknown script and a cycle', () => {
  assert.throws(() => expandScript({}, 'missing'), /unknown package.json script: missing/)
  assert.throws(
    () => expandScript({ a: 'pnpm run b', b: 'pnpm run a' }, 'a'),
    /script cycle: a -> b -> a/,
  )
})

test('the real package.json gate scripts expand without pnpm steps', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  for (const name of ['lint', 'typecheck', 'verify']) {
    const steps = expandScript(scripts, name)
    assert.ok(steps.length > 0)
    assert.ok(
      steps.every((step) => !step.startsWith('pnpm ')),
      `${name}: ${steps.join(' | ')}`,
    )
  }
})

test('exits non-zero with usage when no script is named', () => {
  const result = spawnSync(process.execPath, [verify], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /usage: node scripts\/verify\.mjs/)
})
