// afterPack hook and CLI. Only ASAR metadata is read, never file payloads.
const { statSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { getRawHeader } = require('@electron/asar')

const forbiddenRoots = new Set([
  '.agents',
  '.claude',
  '.codex',
  '.grok',
  '.opencode',
  'src',
  'docs',
  'tmp',
  'pnpm-lock.yaml',
])
const requiredFiles = [
  'package.json',
  'out/main/index.js',
  'out/preload/index.js',
  'out/renderer/index.html',
  'node_modules/better-sqlite3/package.json',
  'node_modules/better-sqlite3/lib/index.js',
  'node_modules/node-pty/package.json',
  'node_modules/node-pty/lib/index.js',
]

function checkPackage(archivePath, { platform = process.platform, arch = process.arch } = {}) {
  const archive = resolve(archivePath)
  if (!['win32', 'linux'].includes(platform) || arch !== 'x64') {
    throw new Error(`Unsupported package target: ${platform}-${arch}`)
  }
  const { header, headerSize } = getRawHeader(archive)
  const archiveSize = statSync(archive).size
  const payloadSize = archiveSize - headerSize - 8
  const entries = new Map()
  function visit(directory, prefix = '') {
    if (!directory.files || typeof directory.files !== 'object') {
      throw new Error(`Invalid ASAR directory: ${prefix || '/'}`)
    }
    for (const [name, entry] of Object.entries(directory.files)) {
      if (
        !name ||
        name.includes('/') ||
        name.includes('\\') ||
        name === '.' ||
        name === '..' ||
        !entry ||
        typeof entry !== 'object'
      ) {
        throw new Error(`Invalid ASAR entry under ${prefix || '/'}`)
      }
      const path = `${prefix}${name}`
      entries.set(path, entry)
      if ('files' in entry) visit(entry, `${path}/`)
    }
  }
  visit(header)
  const forbidden = [...entries.keys()].filter((path) => {
    const segments = path.toLowerCase().split('/')
    return (
      forbiddenRoots.has(segments[0]) ||
      segments.some((name) => name === '.env' || name.startsWith('.env.')) ||
      (segments.length === 1 && path.endsWith('.tsbuildinfo'))
    )
  })
  if (forbidden.length) {
    // Report roots and environment paths, not thousands of their descendants.
    const paths = forbidden.filter(
      (path) => !forbidden.some((parent) => path.startsWith(`${parent}/`)),
    )
    throw new Error(`Forbidden package content in ${archive}:\n${paths.join('\n')}`)
  }
  for (const path of requiredFiles) {
    const entry = entries.get(path)
    if (
      !entry ||
      !Number.isSafeInteger(entry.size) ||
      entry.size <= 0 ||
      'files' in entry ||
      'link' in entry
    ) {
      throw new Error(`Missing or empty required package file: ${path}`)
    }
  }
  // Offsets are relative to the end of the ASAR header. Inspect sizes, not payload bytes.
  for (const [path, entry] of entries) {
    if ('files' in entry || 'link' in entry) continue
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`Invalid package file size: ${path}`)
    }
    if (entry.unpacked) {
      const diskFile = statSync(join(`${archive}.unpacked`, path))
      if (!diskFile.isFile() || diskFile.size !== entry.size) {
        throw new Error(`Missing or incomplete unpacked package file: ${path}`)
      }
    } else {
      const offset = Number(entry.offset)
      if (
        typeof entry.offset !== 'string' ||
        !/^\d+$/.test(entry.offset) ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > payloadSize ||
        entry.size > payloadSize - offset
      ) {
        throw new Error(`Invalid or truncated package payload: ${path}`)
      }
    }
  }
  const sqlite = `node_modules/better-sqlite3/prebuilds/${platform}-${arch}.node`
  const nativeGroups = [[sqlite]]
  for (const name of platform === 'win32' ? ['conpty', 'conpty_console_list'] : ['pty']) {
    nativeGroups.push(
      ['build/Release', 'build/Debug', `prebuilds/${platform}-${arch}`].map(
        (directory) => `node_modules/node-pty/${directory}/${name}.node`,
      ),
    )
  }
  for (const candidates of nativeGroups) {
    if (
      !candidates.some((path) => {
        const entry = entries.get(path)
        return (
          entry?.unpacked === true && entry.size > 0 && !('link' in entry) && !('files' in entry)
        )
      })
    )
      throw new Error(`Missing unpacked native package binary: ${candidates.join(' or ')}`)
  }
  const files = [...entries.values()].filter((entry) => !('files' in entry)).length
  const result = { archive, sizeBytes: archiveSize, entries: entries.size, files }
  console.log(`Package content OK: ${JSON.stringify(result)}`)
  return result
}

module.exports = (context) => {
  if (context.arch !== 1) throw new Error('Only x64 Windows/Linux packages are supported')
  return checkPackage(join(context.appOutDir, 'resources', 'app.asar'), {
    platform: context.electronPlatformName,
    arch: 'x64',
  })
}
module.exports.checkPackage = checkPackage

if (require.main === module) {
  try {
    if (process.argv.length !== 3)
      throw new Error('Usage: node scripts/check-package.cjs <app.asar>')
    checkPackage(process.argv[2])
  } catch (error) {
    console.error(`Package content check failed: ${error.message}`)
    process.exitCode = 1
  }
}
