import { isAbsolute } from 'node:path'
import { AppError } from '../../shared/ipc-error'
import type { AppServices } from './service-registry'

// Payload validation layer in front of the real services (spec Errors:
// validation failures reject with a typed error, no silent fallback).
// Each channel declares its payload shape; violations throw ValidationError
// before any service is touched, and ipc-handlers transports it as
// AppError('validation'). Validated args are sliced to the declared arity and
// passed to the service — no stub values remain (Stage 3 wires terminals/git).

/** Thrown by channel parsers; a typed AppError('validation') on the wire. */
export class ValidationError extends AppError {
  constructor(message: string) {
    super('validation', message)
    this.name = 'ValidationError'
  }
}

type Validator = (value: unknown, label: string) => void

const assertString: Validator = (value, label) => {
  if (typeof value !== 'string') {
    fail(label, 'must be a string')
  }
}

const assertFiniteNumber: Validator = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(label, 'must be a finite number')
  }
}

/**
 * Path-shaped arguments (project roots, terminal cwd) are renderer-supplied
 * strings that become OS operations. Reject ambiguous input up front: NUL
 * bytes, relative paths and '..' segments (traversal).
 */
const assertSafePath: Validator = (value, label) => {
  assertString(value, label)
  const path = value as string
  if (path.includes('\u0000')) {
    fail(label, 'must not contain NUL characters')
  }
  if (!isAbsolute(path)) {
    fail(label, 'must be an absolute path')
  }
  if (path.split(/[\\/]+/).includes('..')) {
    fail(label, 'must not contain ".." segments')
  }
}

function fail(label: string, rule: string): never {
  throw new ValidationError(`${label} ${rule}`)
}

function requireArgs(payload: unknown[], count: number, channel: string): void {
  if (payload.length !== count) {
    throw new ValidationError(`${channel}: expected ${count} argument(s), got ${payload.length}`)
  }
}

export interface ValidatedChannel {
  channel: string
  /** Returns service args extracted from the raw invoke payload. */
  parse: (payload: unknown[]) => unknown[]
  /** Invokes the service with validated args. */
  invoke: (args: unknown[]) => unknown
}

/** Type list for each positional argument of a channel payload. */
type ArgType = 'string' | 'number' | 'path'

/**
 * Channel backed by a real service. Payloads must match the declared arity
 * exactly; validated args are sliced out and handed to the service as-is.
 */
function serviceChannel(
  channel: string,
  argTypes: readonly ArgType[],
  invokeService: (args: never[]) => unknown,
): ValidatedChannel {
  return {
    channel,
    parse: (payload) => {
      requireArgs(payload, argTypes.length, channel)
      argTypes.forEach((type, index) => {
        const label = `${channel} arg[${index}]`
        if (type === 'string') {
          assertString(payload[index], label)
        } else if (type === 'path') {
          assertSafePath(payload[index], label)
        } else {
          assertFiniteNumber(payload[index], label)
        }
      })
      return payload.slice(0, argTypes.length)
    },
    invoke: (args) => invokeService(args as never[]),
  }
}

export function buildValidatedChannels(services: AppServices): ValidatedChannel[] {
  return [
    serviceChannel('projects:list', [], () => services.projects.list()),
    // The Add Project flow opens the native dialog in main (ipc-handlers);
    // the channel payload is empty and the path comes from the dialog.
    serviceChannel('projects:add', [], () =>
      (services.projects.add as (path?: string) => ProjectInfoLike)(),
    ),
    serviceChannel('projects:remove', ['string'], (args) => services.projects.remove(args[0])),
    serviceChannel('chats:list', ['string'], (args) => services.chats.list(args[0])),
    serviceChannel('chats:create', ['string', 'string'], (args) =>
      services.chats.create(args[0], args[1]),
    ),
    // Terminal-exit close flow (spec Behaviour 11): the renderer-driven chat
    // removal; never invoked on application quit.
    serviceChannel('chats:remove', ['string'], (args) => services.chats.remove(args[0])),
    serviceChannel('state:get', ['string'], (args) => services.state.get(args[0])),
    serviceChannel('state:set', ['string', 'string'], (args) =>
      services.state.set(args[0], args[1]),
    ),
    // Chat terminals (Stage 3): one PTY per chat, spawned lazily on create.
    serviceChannel('terminals:create', ['string', 'path'], (args) =>
      services.terminals.create(args[0], args[1]),
    ),
    serviceChannel('terminals:write', ['string', 'string'], (args) =>
      services.terminals.write(args[0], args[1]),
    ),
    serviceChannel('terminals:resize', ['string', 'number', 'number'], (args) =>
      services.terminals.resize(args[0], args[1], args[2]),
    ),
    // Read-only git status; failures degrade to "no git" inside the service.
    serviceChannel('git:status', ['path'], (args) => services.git.getStatus(args[0])),
  ]
}

/** Local structural type keeping the projects:add cast self-documenting. */
interface ProjectInfoLike {
  id: string
  name: string
  path: string
  runtimeLabel: string | null
}
