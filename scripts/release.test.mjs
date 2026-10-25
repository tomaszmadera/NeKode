import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  createDraftRelease,
  gateRelease,
  parseVersion,
  prepareRelease,
  releaseNotes,
} from './release.mjs'

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'nekode-release-test-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Release test')
  git('config', 'user.email', 'release-test@example.invalid')
  const commit = (subject) => git('commit', '--allow-empty', '-m', subject)
  writeFileSync(join(cwd, 'package.json'), '{"version":"0.14.19"}')
  git('add', 'package.json')
  commit('chore: previous release')
  git('tag', '-a', '0.14.19', '-m', 'Previous release')
  const previous = git('rev-parse', 'HEAD')
  writeFileSync(join(cwd, 'package.json'), '{"version":"0.15.0"}')
  git('add', 'package.json')
  commit('feat(terminal)!: add a terminal setting')
  commit('fix: keep [links] safe <script>')
  commit('chore: bump version to 0.15.0')
  commit('chore: bump versioning documentation')
  commit('A useful non-conventional change')
  git('tag', '0.15.0')
  git('tag', 'unrelated-tag')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  return { cwd, git, previous }
}

const repository = 'example/NeKode'
const version = '0.15.0'
const ref = `refs/tags/${version}`

function binaries(cwd) {
  writeFileSync(join(cwd, `NeKode-Setup-${version}.exe`), 'abc')
  writeFileSync(join(cwd, `NeKode-${version}-x86_64.AppImage`), 'abc')
}

function api(releases = []) {
  const calls = []
  const github = {
    paginate: async (_method, params) => {
      calls.push(['list', params])
      return releases
    },
    rest: {
      git: {
        getRef: async () => ({ data: { object: { type: 'commit', sha: github.tagSha } } }),
      },
      repos: {
        listReleases: 'listReleases',
        createRelease: async (params) => {
          calls.push(['create', params])
          return { data: { id: 42, html_url: 'https://example.invalid/release' } }
        },
        uploadReleaseAsset: async (params) => {
          calls.push(['upload', params])
          return { data: { name: params.name } }
        },
        getRelease: async (params) => {
          calls.push(['get', params])
          return { data: { id: 42, draft: true } }
        },
        deleteRelease: async (params) => {
          calls.push(['delete', params])
        },
      },
    },
  }
  return { github, calls }
}

function publication(cwd, github) {
  return {
    github,
    context: {
      eventName: 'push',
      ref,
      repo: { owner: 'example', repo: 'NeKode' },
      serverUrl: 'https://github.com',
    },
    cwd,
    directory: cwd,
    version,
  }
}

test('numeric versions are normal releases, and valid suffixes are prereleases', () => {
  assert.deepEqual(parseVersion('0.15.0'), { version: '0.15.0', prerelease: false })
  assert.equal(parseVersion('1.0.0-rc.1').prerelease, true)
  assert.equal(parseVersion('1.0.0+build.12').prerelease, true)
  for (const invalid of ['v1.0.0', '01.0.0', '1.0', '1.0.0-01', '1.0.0-', '1.0.0\n', 'test']) {
    assert.throws(() => parseVersion(invalid), /Invalid numeric semver/)
  }
})

test('the tag gate accepts the exact tagged main commit, including annotated tags', (t) => {
  const { cwd, git } = fixture(t)
  git('tag', '-d', version)
  git('tag', '-a', version, '-m', 'Release')
  assert.deepEqual(gateRelease({ cwd, eventName: 'push', ref }), {
    version,
    prerelease: false,
  })
})

test('the tag gate names version mismatch, off-main and wrong-checkout failures', (t) => {
  const { cwd, git, previous } = fixture(t)
  assert.throws(
    () => gateRelease({ cwd, eventName: 'push', ref: 'refs/tags/0.15.1' }),
    /Tag 0.15.1 does not match package.json version 0.15.0/,
  )
  git('update-ref', 'refs/remotes/origin/main', previous)
  assert.throws(() => gateRelease({ cwd, eventName: 'push', ref }), /not reachable from main/)
  git('tag', '-f', version, previous)
  assert.throws(
    () => gateRelease({ cwd, eventName: 'push', ref }),
    /Checkout does not match tagged commit/,
  )
})

test('manual builds read package version without requiring a tag or main ancestry', (t) => {
  const { cwd, git } = fixture(t)
  git('update-ref', '-d', 'refs/remotes/origin/main')
  assert.equal(
    gateRelease({ cwd, eventName: 'workflow_dispatch', ref: 'refs/heads/main' }).version,
    version,
  )
  assert.throws(() => gateRelease({ cwd, eventName: 'push', ref: 'refs/heads/main' }), /tag push/)
})

test('notes use the previous version tag, group types and omit only version bumps', (t) => {
  const { cwd } = fixture(t)
  const notes = releaseNotes({ cwd, version, repository })
  assert.match(notes, /0\.14\.19\.\.\.0\.15\.0/)
  assert.match(notes, /### Features\n\n- feat/)
  assert.match(notes, /### Fixes/)
  assert.match(notes, /### Other/)
  assert.match(notes, /bump versioning documentation/)
  assert.doesNotMatch(notes, /bump version to 0.15.0|previous release/)
  assert.doesNotMatch(notes, /<script>/)
  assert.match(notes, /beta/i)
  assert.match(notes, /App Settings/)
  assert.match(notes, /replacing the AppImage/)
  assert.match(notes, /no background updater/i)
  assert.match(notes, /SmartScreen/)
  assert.match(notes, /releases\/download\/0.15.0\/SHA256SUMS.txt/)
  assert.match(notes, /docs\/operations\/releases.md/)
})

test('notes fail when no previous version tag exists', (t) => {
  const { cwd, git } = fixture(t)
  git('tag', '-d', '0.14.19')
  assert.throws(() => releaseNotes({ cwd, version, repository }), /No previous version tag/)
})

test('checksums cover exactly the two named, nonempty binaries in sha256sum format', async (t) => {
  const { cwd } = fixture(t)
  binaries(cwd)
  await prepareRelease({ cwd, directory: cwd, version, repository })
  const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  assert.equal(
    readFileSync(join(cwd, 'SHA256SUMS.txt'), 'utf8'),
    `${digest}  NeKode-Setup-${version}.exe\n${digest}  NeKode-${version}-x86_64.AppImage\n`,
  )
  writeFileSync(join(cwd, `NeKode-${version}-x86_64.AppImage`), '')
  await assert.rejects(prepareRelease({ cwd, directory: cwd, version, repository }), /empty/)
})

test('missing binaries and manual dispatch cannot create a release', async (t) => {
  const { cwd } = fixture(t)
  const { github, calls } = api()
  await assert.rejects(createDraftRelease(publication(cwd, github)), /Missing release file/)
  assert.equal(calls.length, 0)
  binaries(cwd)
  const options = publication(cwd, github)
  options.context.eventName = 'workflow_dispatch'
  await assert.rejects(createDraftRelease(options), /Only a tag push can create/)
  assert.equal(calls.length, 0)
})

test('existing drafts and published releases are rejected without mutation', async (t) => {
  const { cwd, git } = fixture(t)
  binaries(cwd)
  for (const draft of [true, false]) {
    const { github, calls } = api([{ tag_name: version, draft }])
    github.tagSha = git('rev-parse', 'HEAD')
    await assert.rejects(
      createDraftRelease(publication(cwd, github)),
      /already exists.*not be overwritten/,
    )
    assert.deepEqual(
      calls.map(([operation]) => operation),
      ['list'],
    )
  }
})

test('a moved remote tag is rejected before creating a draft', async (t) => {
  const { cwd, previous } = fixture(t)
  binaries(cwd)
  const { github, calls } = api()
  github.tagSha = previous
  await assert.rejects(createDraftRelease(publication(cwd, github)), /Remote tag.*verified commit/)
  assert.ok(calls.every(([operation]) => operation !== 'create'))
})

test('a valid tag creates only a draft and uploads exactly the binaries and checksums', async (t) => {
  const { cwd, git } = fixture(t)
  binaries(cwd)
  const { github, calls } = api()
  github.tagSha = git('rev-parse', 'HEAD')
  await createDraftRelease(publication(cwd, github))
  const created = calls.find(([operation]) => operation === 'create')[1]
  assert.equal(created.draft, true)
  assert.equal(created.prerelease, false)
  assert.equal(created.name, `NeKode ${version}`)
  assert.deepEqual(
    calls.filter(([operation]) => operation === 'upload').map(([, params]) => params.name),
    [`NeKode-Setup-${version}.exe`, `NeKode-${version}-x86_64.AppImage`, 'SHA256SUMS.txt'],
  )
})

function failSecondUpload(github) {
  const error = new Error('AppImage upload failed')
  const upload = github.rest.repos.uploadReleaseAsset
  let attempts = 0
  github.rest.repos.uploadReleaseAsset = async (params) => {
    await upload(params)
    if (++attempts === 2) throw error
  }
  return error
}

test('a partial upload failure removes only the freshly confirmed created draft', async (t) => {
  const { cwd, git } = fixture(t)
  binaries(cwd)
  const { github, calls } = api([{ id: 7, tag_name: '0.14.19', draft: true }])
  github.tagSha = git('rev-parse', 'HEAD')
  const error = failSecondUpload(github)
  await assert.rejects(createDraftRelease(publication(cwd, github)), (actual) => actual === error)
  assert.deepEqual(
    calls.map(([operation]) => operation),
    ['list', 'create', 'upload', 'upload', 'get', 'delete'],
  )
  const target = { owner: 'example', repo: 'NeKode', release_id: 42 }
  assert.deepEqual(calls.find(([operation]) => operation === 'get')[1], target)
  assert.deepEqual(calls.find(([operation]) => operation === 'delete')[1], target)
})

test('upload cleanup never deletes a published or unconfirmed release', async (t) => {
  const { cwd, git } = fixture(t)
  binaries(cwd)
  for (const state of [{ id: 42, draft: false }, { id: 42 }, { id: 7, draft: true }]) {
    const { github, calls } = api()
    github.tagSha = git('rev-parse', 'HEAD')
    const error = failSecondUpload(github)
    github.rest.repos.getRelease = async (params) => {
      calls.push(['get', params])
      return { data: state }
    }
    await assert.rejects(createDraftRelease(publication(cwd, github)), (actual) => {
      assert.equal(actual.cause, error)
      assert.match(actual.message, /AppImage upload failed/)
      assert.match(actual.message, /cleanup.*cannot confirm.*draft/i)
      return true
    })
    assert.deepEqual(
      calls.map(([operation]) => operation),
      ['list', 'create', 'upload', 'upload', 'get'],
    )
  }
})

test('readback and deletion failures report both errors without masking the upload failure', async (t) => {
  const { cwd, git } = fixture(t)
  binaries(cwd)
  for (const operation of ['getRelease', 'deleteRelease']) {
    const { github, calls } = api()
    github.tagSha = git('rev-parse', 'HEAD')
    const error = failSecondUpload(github)
    const cleanupError = new Error(`${operation} unavailable`)
    github.rest.repos[operation] = async (params) => {
      calls.push([operation === 'getRelease' ? 'get' : 'delete', params])
      throw cleanupError
    }
    await assert.rejects(createDraftRelease(publication(cwd, github)), (actual) => {
      assert.equal(actual.cause, error)
      assert.deepEqual(actual.errors, [error, cleanupError])
      assert.match(actual.message, /AppImage upload failed/)
      assert.ok(actual.message.includes(cleanupError.message))
      return true
    })
    assert.deepEqual(
      calls.map(([action]) => action),
      operation === 'getRelease'
        ? ['list', 'create', 'upload', 'upload', 'get']
        : ['list', 'create', 'upload', 'upload', 'get', 'delete'],
    )
  }
})
