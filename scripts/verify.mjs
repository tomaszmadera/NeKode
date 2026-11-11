// Runs package.json scripts by name without needing pnpm on PATH, so the
// harness verification gates work the same on Windows and Linux. A
// `pnpm run <name>` step expands to that script's own steps; every other step
// runs in the platform shell with node_modules/.bin first on PATH.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const NESTED_RUN = /^pnpm run (\S+)$/

/** The flat command list for one script, with nested `pnpm run` steps expanded. */
export function expandScript(scripts, name, seen = []) {
  if (seen.includes(name)) throw new Error(`script cycle: ${[...seen, name].join(' -> ')}`)
  const body = scripts[name]
  if (typeof body !== 'string') throw new Error(`unknown package.json script: ${name}`)
  return body
    .split('&&')
    .map((step) => step.trim())
    .flatMap((step) => {
      const nested = NESTED_RUN.exec(step)
      return nested ? expandScript(scripts, nested[1], [...seen, name]) : [step]
    })
}

function main(names) {
  if (names.length === 0) throw new Error('usage: node scripts/verify.mjs <script> [<script> ...]')
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const steps = names.flatMap((name) => expandScript(scripts, name))
  const env = { ...process.env }
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
  env[pathKey] = [join(root, 'node_modules', '.bin'), env[pathKey]].filter(Boolean).join(delimiter)
  for (const step of steps) {
    console.log(`> ${step}`)
    const result = spawnSync(step, { cwd: root, env, shell: true, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) {
      console.error(`failed (exit ${result.status ?? result.signal}): ${step}`)
      return result.status ?? 1
    }
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
