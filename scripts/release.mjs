import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// SemVer 2.0.0, without the repository's disallowed "v" prefix.
const numeric = '(0|[1-9][0-9]*)'
const identifier = '(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)'
const semver = new RegExp(
  `^${numeric}\\.${numeric}\\.${numeric}(-${identifier}(?:\\.${identifier})*)?(\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`,
)

export function parseVersion(version) {
  const match = typeof version === 'string' && semver.exec(version)
  if (!match || match[0] !== version) throw new Error(`Invalid numeric semver: ${version}`)
  // The release contract classifies every suffixed tag as a prerelease, including 0.x.
  return { version, prerelease: Boolean(match[4] || match[5]) }
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim()
}

export function gateRelease({ cwd = process.cwd(), eventName, ref }) {
  const { version } = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  const metadata = parseVersion(version)
  if (eventName === 'workflow_dispatch') return metadata
  if (eventName !== 'push' || !ref?.startsWith('refs/tags/')) {
    throw new Error('Release gate requires a tag push or workflow_dispatch')
  }
  const tag = ref.slice('refs/tags/'.length)
  parseVersion(tag)
  if (tag !== version) {
    throw new Error(`Tag ${tag} does not match package.json version ${version}`)
  }
  const commit = git(cwd, 'rev-parse', '--verify', `${ref}^{commit}`)
  if (git(cwd, 'rev-parse', 'HEAD') !== commit) {
    throw new Error(`Checkout does not match tagged commit ${commit}`)
  }
  const ancestry = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main'],
    { cwd, encoding: 'utf8' },
  )
  if (ancestry.error) throw ancestry.error
  if (ancestry.status === 1) throw new Error(`Tagged commit ${commit} is not reachable from main`)
  if (ancestry.status !== 0) {
    throw new Error(`Cannot check main reachability: ${ancestry.stderr.trim()}`)
  }
  return metadata
}

function escapeMarkdown(text) {
  return text.replace(/[\\`*_{}[\]()#+.!<>|]/g, '\\$&')
}

export function releaseNotes({
  cwd = process.cwd(),
  version,
  repository,
  serverUrl = 'https://github.com',
}) {
  parseVersion(version)
  const candidates = git(cwd, 'tag', '--merged', 'HEAD')
    .split('\n')
    .filter((tag) => tag !== version && semver.test(tag))
  if (!candidates.length) throw new Error('No previous version tag exists for release notes')
  // Let Git choose the nearest reachable version tag, rather than a tag on another branch.
  const previous = git(
    cwd,
    'describe',
    '--tags',
    '--abbrev=0',
    ...candidates.flatMap((tag) => ['--match', tag]),
    'HEAD',
  )
  const base = `${serverUrl}/${repository}`
  const groups = new Map()
  const labels = {
    feat: 'Features',
    fix: 'Fixes',
    perf: 'Performance',
    refactor: 'Refactoring',
    docs: 'Documentation',
    test: 'Tests',
    build: 'Build',
    ci: 'CI',
    chore: 'Maintenance',
    style: 'Style',
    revert: 'Reverts',
  }
  for (const line of git(cwd, 'log', '--format=%H%x09%s', `${previous}..HEAD`).split('\n')) {
    if (!line) continue
    const separator = line.indexOf('\t')
    const sha = line.slice(0, separator)
    const subject = line.slice(separator + 1)
    if (/^chore(?:\([^)]*\))?!?: bump version(?:\s|$)/i.test(subject)) continue
    const type = /^([a-z]+)(?:\([^)]*\))?!?: /.exec(subject)?.[1]
    const label = Object.hasOwn(labels, type) ? labels[type] : (type ?? 'Other')
    if (!groups.has(label)) groups.set(label, [])
    groups
      .get(label)
      .push(`- ${escapeMarkdown(subject)} ([${sha.slice(0, 7)}](${base}/commit/${sha}))`)
  }
  const changes = [...groups].map(([label, lines]) => `### ${label}\n\n${lines.join('\n')}`)
  return [
    `## Changes\n\n[All commits since ${previous}](${base}/compare/${previous}...${version})`,
    ...changes,
    '## Before installing',
    'NeKode is beta software.',
    'There is no auto-updater. To update, download and install the new version manually.',
    'The Windows installer is unsigned, so Windows SmartScreen may show a warning.',
    `[Download SHA256SUMS.txt](${base}/releases/download/${version}/SHA256SUMS.txt) and [verify the checksums](${base}/blob/${version}/docs/operations/releases.md) before installing.`,
    '',
  ].join('\n\n')
}

function releaseFiles(directory, version) {
  return [`NeKode-Setup-${version}.exe`, `NeKode-${version}-x86_64.AppImage`].map((name) => {
    const path = join(directory, name)
    if (!existsSync(path)) throw new Error(`Missing release file: ${name}`)
    const stat = statSync(path)
    if (!stat.isFile() || stat.size === 0)
      throw new Error(`Release file is empty or invalid: ${name}`)
    return { name, path }
  })
}

export async function prepareRelease({
  cwd = process.cwd(),
  directory,
  version,
  repository,
  serverUrl,
}) {
  parseVersion(version)
  const files = releaseFiles(directory, version)
  const body = releaseNotes({ cwd, version, repository, serverUrl })
  const sums = []
  for (const file of files) {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file.path)) hash.update(chunk)
    sums.push(`${hash.digest('hex')}  ${file.name}\n`)
  }
  const checksums = { name: 'SHA256SUMS.txt', path: join(directory, 'SHA256SUMS.txt') }
  writeFileSync(checksums.path, sums.join(''))
  return { files: [...files, checksums], body }
}

// The SDK is supplied by actions/github-script; this module has no package dependencies.
export async function createDraftRelease({
  github,
  context,
  cwd = process.cwd(),
  directory,
  version,
}) {
  if (context.eventName !== 'push' || context.ref !== `refs/tags/${version}`) {
    throw new Error('Only a tag push can create a draft release')
  }
  const metadata = gateRelease({ cwd, eventName: context.eventName, ref: context.ref })
  const { files, body } = await prepareRelease({
    cwd,
    directory,
    version,
    repository: `${context.repo.owner}/${context.repo.repo}`,
    serverUrl: context.serverUrl,
  })
  const existing = await github.paginate(github.rest.repos.listReleases, {
    ...context.repo,
    per_page: 100,
  })
  if (existing.some((release) => release.tag_name === version)) {
    throw new Error(`Release ${version} already exists and will not be overwritten`)
  }
  let { object } = (await github.rest.git.getRef({ ...context.repo, ref: `tags/${version}` })).data
  // Dereference annotated tags before comparing the remote ref with the verified build commit.
  for (let depth = 0; object.type === 'tag' && depth < 16; depth++) {
    ;({ object } = (await github.rest.git.getTag({ ...context.repo, tag_sha: object.sha })).data)
  }
  if (object.type !== 'commit' || object.sha !== git(cwd, 'rev-parse', 'HEAD')) {
    throw new Error(`Remote tag ${version} no longer points to the verified commit`)
  }
  const { data: release } = await github.rest.repos.createRelease({
    ...context.repo,
    tag_name: version,
    target_commitish: object.sha,
    name: `NeKode ${version}`,
    body,
    draft: true,
    prerelease: metadata.prerelease,
  })
  try {
    for (const file of files) {
      await github.rest.repos.uploadReleaseAsset({
        ...context.repo,
        release_id: release.id,
        name: file.name,
        data: readFileSync(file.path),
        headers: { 'content-type': 'application/octet-stream' },
      })
    }
  } catch (uploadError) {
    try {
      const target = { ...context.repo, release_id: release.id }
      const { data: current } = await github.rest.repos.getRelease(target)
      if (current.id !== release.id || current.draft !== true) {
        throw new Error(`Cannot confirm release ${release.id} is still the created draft`)
      }
      await github.rest.repos.deleteRelease(target)
    } catch (cleanupError) {
      throw new AggregateError(
        [uploadError, cleanupError],
        `Asset upload failed: ${uploadError}; cleanup of created draft ${release.id} failed: ${cleanupError}`,
        { cause: uploadError },
      )
    }
    throw uploadError
  }
  return release.html_url
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] !== 'gate') throw new Error('Usage: node scripts/release.mjs gate')
  const metadata = gateRelease({
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
  })
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${metadata.version}\n`)
  console.log(`Release gates passed for ${metadata.version}`)
}
