// Reference adapter for the version 1, one-request-per-process boundary.
// Main also ships this file reader in-process, so no Node install is needed.
// Error codes follow spec rule 13: only a rejected path is `config`; a missing file and
// unreadable or malformed content are transient so the local 5-second cadence recovers.
const fs = require('node:fs')
const path = require('node:path')

class Failure extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
  if (Buffer.byteLength(input) > 64 * 1024) process.exit(1)
})
process.stdin.on('end', () => {
  try {
    let request
    try {
      request = JSON.parse(input)
    } catch {
      throw new Failure('protocol', 'Invalid usage adapter request.')
    }
    if (request.protocolVersion !== 1 || request.action !== 'read')
      throw new Failure('protocol', 'Unsupported usage adapter request.')
    const file = request.config?.path
    if (typeof file !== 'string' || !path.isAbsolute(file))
      throw new Failure('config', 'Usage input path must be absolute.')
    let bytes
    try {
      if (fs.statSync(file).size > 1048576)
        throw new Failure('validation_error', 'Usage file exceeds 1 MiB.')
      bytes = fs.readFileSync(file)
    } catch (error) {
      if (error instanceof Failure) throw error
      throw new Failure('io', 'Cannot read usage file. Collection retries automatically.')
    }
    if (bytes.length > 1048576) throw new Failure('validation_error', 'Usage file exceeds 1 MiB.')
    let data
    try {
      data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      throw new Failure('protocol', 'Cannot parse usage file. Write one complete JSON document.')
    }
    if (
      data.schemaVersion !== 1 ||
      !Array.isArray(data.subscriptions) ||
      data.subscriptions.length !== 1 ||
      data.subscriptions[0].id !== request.params?.connectionId
    )
      throw new Failure('validation_error', 'Usage file must hold this connection, version 1.')
    process.stdout.write(JSON.stringify({ protocolVersion: 1, ok: true, data }))
  } catch (error) {
    const known = error instanceof Failure
    process.stdout.write(
      JSON.stringify({
        protocolVersion: 1,
        ok: false,
        error: {
          code: known ? error.code : 'io',
          message: known ? error.message : 'Cannot read usage file.',
        },
      }),
    )
    process.exitCode = 1
  }
})
