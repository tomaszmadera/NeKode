// Previewed, separately enabled setup for the NeKode Claude Code usage collector.
//
//   node setup.cjs --settings <claude settings.json> --output <absolute usage json>
//                  --connection-id <id> [--provider-id claude] [--node <node executable>]
//                  [--apply | --remove]
//
// Without --apply or --remove the script only prints the proposed change. --apply writes a
// backup next to the settings file and replaces `statusLine.command` with the collector, piping
// the existing status-line command after it so its output is retained. Other statusLine fields
// (padding, refreshInterval, ...) and every other setting are kept. --remove restores the backed
// up status line exactly. The settings path is always explicit; nothing is modified by default.
// Docs: docs/features/usage-quota/claude-code.md
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const MARKER = '--nekode-usage'
const COLLECTOR = path.join(__dirname, 'collector.cjs')

class SetupError extends Error {}

function parseArgs(argv) {
  const options = { providerId: 'claude', node: 'node', mode: 'preview' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--apply' || arg === '--remove') {
      if (options.mode !== 'preview') throw new SetupError('Choose either --apply or --remove.')
      options.mode = arg.slice(2)
    } else if (
      ['--settings', '--output', '--connection-id', '--provider-id', '--node'].includes(arg)
    )
      options[arg.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i]
    else throw new SetupError(`Unknown argument ${arg}.`)
  }
  if (typeof options.settings !== 'string' || !path.isAbsolute(options.settings))
    throw new SetupError('--settings must be the absolute path of a Claude Code settings.json.')
  if (options.mode === 'remove') return options
  if (typeof options.output !== 'string' || !path.isAbsolute(options.output))
    throw new SetupError('--output must be an absolute path for the normalized usage file.')
  if (!fs.existsSync(path.dirname(options.output)))
    throw new SetupError('The --output folder does not exist. Create it first.')
  if (path.resolve(options.output).toLowerCase() === path.resolve(options.settings).toLowerCase())
    throw new SetupError('--output must differ from the settings file.')
  if (!ID_PATTERN.test(options.connectionId ?? '') || !ID_PATTERN.test(options.providerId))
    throw new SetupError('--connection-id and --provider-id use 1-128 letters, digits, . _ -')
  return options
}

/** Quote a path for both Git Bash and PowerShell, which Claude Code uses on Windows. */
function shellPath(value) {
  const forward = value.replace(/\\/g, '/')
  if (/["`$\n\r]/.test(forward))
    throw new SetupError('Paths cannot contain quotes, backticks, $ or line breaks.')
  return `"${forward}"`
}

function collectorCommand(options, passThrough) {
  const node = options.node === 'node' ? 'node' : shellPath(options.node)
  return [
    node,
    shellPath(COLLECTOR),
    '--output',
    shellPath(options.output),
    '--connection-id',
    options.connectionId,
    '--provider-id',
    options.providerId,
    ...(passThrough ? ['--pass-through'] : []),
    MARKER,
  ].join(' ')
}

function readSettings(file) {
  if (!fs.existsSync(file)) return { exists: false, settings: {} }
  let settings
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new SetupError('Cannot parse the settings file as JSON. Fix it before setup.')
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    throw new SetupError('The settings file must contain a JSON object.')
  return { exists: true, settings }
}

const backupPath = (settingsFile) => `${settingsFile}.nekode-usage-backup.json`

/** Compute the proposed status line without writing anything. */
function plan(options) {
  const { exists, settings } = readSettings(options.settings)
  const current = settings.statusLine ?? null
  if (current !== null && (typeof current !== 'object' || Array.isArray(current)))
    throw new SetupError('The existing statusLine is not an object. Fix it before setup.')
  if (current && current.type !== 'command')
    throw new SetupError('Only a statusLine of type "command" can be retained.')
  if (current && typeof current.command === 'string' && current.command.includes(MARKER))
    throw new SetupError('The NeKode collector is already configured. Run --remove first.')
  const original = current && typeof current.command === 'string' ? current.command.trim() : ''
  const command = original
    ? `${collectorCommand(options, true)} | ${original}`
    : collectorCommand(options, false)
  const warnings = []
  if (/&&|\|\||;|\n/.test(original))
    warnings.push(
      'The existing command looks compound. Only its first part receives the piped input; move it into a script if its output changes.',
    )
  if (fs.existsSync(backupPath(options.settings)))
    throw new SetupError('A NeKode setup backup already exists. Run --remove first.')
  return {
    settingsFile: options.settings,
    settingsExists: exists,
    backupFile: backupPath(options.settings),
    current,
    proposed: { ...(current ?? {}), type: 'command', command },
    output: options.output,
    warnings,
  }
}

function writeJson(file, value, exclusive) {
  const temporary = `${file}.${randomUUID()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  try {
    if (exclusive && fs.existsSync(file)) throw new SetupError(`${file} already exists.`)
    fs.renameSync(temporary, file)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function apply(options) {
  const proposal = plan(options)
  const { settings } = readSettings(options.settings)
  writeJson(
    proposal.backupFile,
    { version: 1, statusLine: proposal.current, installed: proposal.proposed.command },
    true,
  )
  writeJson(options.settings, { ...settings, statusLine: proposal.proposed }, false)
  return proposal
}

function remove(options) {
  const file = backupPath(options.settings)
  if (!fs.existsSync(file)) throw new SetupError('No NeKode setup backup was found.')
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'))
  const { settings } = readSettings(options.settings)
  if (settings.statusLine?.command !== backup.installed)
    throw new SetupError(
      'The status line changed after setup. Restore it manually from the backup file.',
    )
  const next = { ...settings }
  if (backup.statusLine === null) delete next.statusLine
  else next.statusLine = backup.statusLine
  writeJson(options.settings, next, false)
  fs.unlinkSync(file)
  return { settingsFile: options.settings, restored: backup.statusLine }
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    const result =
      options.mode === 'apply'
        ? apply(options)
        : options.mode === 'remove'
          ? remove(options)
          : plan(options)
    process.stdout.write(
      `${JSON.stringify({ mode: options.mode, written: options.mode !== 'preview', ...result }, null, 2)}\n`,
    )
  } catch (error) {
    process.stderr.write(
      `${error instanceof SetupError ? error.message : `Setup failed: ${error.message}`}\n`,
    )
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = { MARKER, apply, collectorCommand, parseArgs, plan, remove }
