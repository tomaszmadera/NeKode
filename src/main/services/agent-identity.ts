const AGENT_NAMES: Readonly<Record<string, string>> = {
  codex: 'Codex',
  claude: 'Claude',
  'claude-code': 'Claude',
  grok: 'Grok',
  gemini: 'Gemini',
  'gemini-cli': 'Gemini',
  hermes: 'Hermes',
  agy: 'AntiGravity',
  antigravity: 'AntiGravity',
  opencode: 'OpenCode',
  '@openai/codex': 'Codex',
  '@anthropic-ai/claude-code': 'Claude',
  '@google/gemini-cli': 'Gemini',
}

function commandName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.(exe|cmd|bat|ps1|mjs|cjs|js)$/i, '')
}

const NODE_VALUE_OPTIONS = new Set([
  '-r',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
  '-C',
  '--conditions',
  '--env-file',
  '--env-file-if-exists',
  '--inspect-port',
  '--title',
  '--icu-data-dir',
  '--openssl-config',
])

function nodeScript(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--') return args[index + 1]
    if (arg === '-' || /^(?:-e|-p|--eval|--print)(?:=|$)/.test(arg)) return undefined
    if (NODE_VALUE_OPTIONS.has(arg)) {
      index++
    } else if (!arg.startsWith('-')) {
      return arg
    }
  }
  return undefined
}

/** Display only: derive identity from the actual launch argv without executing it. */
export function agentDisplayName(executable: string, args: readonly string[]): string {
  let name = commandName(executable)
  if (name.toLowerCase() === 'node' || name.toLowerCase() === 'nodejs') {
    const script = nodeScript(args)
    if (script !== undefined) {
      const normalized = script.replace(/\\/g, '/')
      const packageName = /(?:^|\/)node_modules\/(@[^/]+\/[^/]+)\//.exec(normalized)?.[1]
      if (packageName !== undefined && Object.hasOwn(AGENT_NAMES, packageName)) {
        return AGENT_NAMES[packageName]
      }
      name = commandName(script)
    }
  }
  const key = name.toLowerCase()
  return Object.hasOwn(AGENT_NAMES, key) ? AGENT_NAMES[key] : name
}

/**
 * Index of the first argument the AGENT owns. A direct CLI owns its whole argv;
 * a Node launch owns what follows the script (`node <script> …`), so a flag for
 * the agent must never be placed in front of the script, which Node would read
 * as one of its own options.
 */
export function agentArgIndex(executable: string, args: readonly string[]): number {
  const name = commandName(executable).toLowerCase()
  if (name !== 'node' && name !== 'nodejs') return 0
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    // `node -- <script> …`: the first program argument after `--` is the script.
    if (arg === '--') return Math.min(index + 2, args.length)
    // No script at all (eval/print/stdin): append rather than risk a node option.
    if (arg === '-' || /^(?:-e|-p|--eval|--print)(?:=|$)/.test(arg)) return args.length
    if (NODE_VALUE_OPTIONS.has(arg)) {
      index++
    } else if (!arg.startsWith('-')) {
      return index + 1
    }
  }
  return args.length
}
