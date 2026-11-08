#!/usr/bin/env node
// Fake ssh harness for tests: behaves like sshd for one invocation. It joins
// the remote command words after `--` with single spaces (exactly what ssh
// sends), records the joined line, and runs it through `sh -c` like a remote
// login shell would. Test-only; never shipped and never wired into main.
//
// Environment:
//   FAKE_SSH_CAPTURE  file that receives the joined remote command line
//   FAKE_SSH_CHATTER  when set, print a login banner to stdout first
//   FAKE_SSH_EXIT     exit with this code instead of running the command
//   FAKE_SSH_SH       POSIX shell used to run the command

const { appendFileSync, writeSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

const argv = process.argv.slice(2)
const separator = argv.indexOf('--')
const remoteWords = separator === -1 ? [] : argv.slice(separator + 2)
const commandLine = remoteWords.join(' ')

const capture = process.env.FAKE_SSH_CAPTURE
if (capture) appendFileSync(capture, `${commandLine}\n`, 'utf8')

if (process.env.FAKE_SSH_CHATTER) {
  process.stdout.write('Welcome to fake-ssh\nLast login: yesterday\n')
}

const forcedExit = process.env.FAKE_SSH_EXIT
if (forcedExit !== undefined) {
  process.exit(Number(forcedExit))
}

const candidates = [
  process.env.FAKE_SSH_SH,
  'sh',
  'C:/Program Files/Git/bin/sh.exe',
  'C:/Program Files/Git/usr/bin/sh.exe',
  '/bin/sh',
  'bash',
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0)

// Stdio stays binary so a remote file read with NUL bytes or invalid UTF-8
// reaches the caller unchanged (the client captures stdout as bytes).
const MAX_BUFFER_BYTES = 8 * 1024 * 1024

let result
for (const shell of candidates) {
  const attempt = spawnSync(shell, ['-c', commandLine], {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_BUFFER_BYTES,
  })
  if (attempt.error) continue
  result = attempt
  break
}

if (result === undefined) {
  process.stderr.write('fake-ssh: no POSIX shell available\n')
  process.exit(90)
}
function writeAll(fd, buffer) {
  if (!buffer || buffer.length === 0) return
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  let offset = 0
  while (offset < buf.length) {
    offset += writeSync(fd, buf, offset, buf.length - offset)
  }
}

if (result.stdout) writeAll(1, result.stdout)
if (result.stderr) writeAll(2, result.stderr)
process.exit(result.status === null ? 1 : result.status)
