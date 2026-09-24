import { isAbsolute } from 'node:path'
import { AppError } from '../../shared/ipc-error'
import type { AppServices } from './service-registry'

// Payload validation layer in front of the real services (spec Errors:
// validation failures reject with a typed error, no silent fallback).
// Each channel declares its payload shape; violations throw ValidationError
// before any service is touched, and ipc-handlers transports it as
// AppError('validation').

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
 * strings that future stages turn into OS operations. Reject ambiguous input
 * up front: NUL bytes, relative paths and '..' segments (traversal). Symlink
 * escapes matter for project-relative file ops, which do not exist yet.
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

/**
 * Channel backed by a real Stage 2 service. Every argument the service takes
 * is a string; payloads must match that arity exactly.
 */
function serviceChannel(
  channel: string,
  argCount: number,
  invokeService: (args: string[]) => unknown,
): ValidatedChannel {
  return {
    channel,
    parse: (payload) => {
      requireArgs(payload, argCount, channel)
      for (let index = 0; index < argCount; index += 1) {
        assertString(payload[index], `${channel} arg[${index}]`)
      }
      return payload.slice(0, argCount)
    },
    invoke: (args) => invokeService(args as string[]),
  }
}

/** Type list for each positional argument of a stub channel payload. */
type StubArgType = 'string' | 'number' | 'path'

/** Stage 3 channel: payload validated, invocation returns a fixed value. */
function stubChannel(
  channel: string,
  argTypes: readonly StubArgType[],
  value: unknown,
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
      return []
    },
    invoke: () => value,
  }
}

export function buildValidatedChannels(services: AppServices): ValidatedChannel[] {
  return [
    serviceChannel('projects:list', 0, () => services.projects.list()),
    // The Add Project flow opens the native dialog in main (ipc-handlers);
    // the channel payload is empty and the path comes from the dialog.
    serviceChannel('projects:add', 0, () =>
      (services.projects.add as (path?: string) => ProjectInfoLike)(),
    ),
    serviceChannel('projects:remove', 1, (args) => services.projects.remove(args[0])),
    serviceChannel('tasks:list', 1, (args) => services.tasks.list(args[0])),
    serviceChannel('tasks:create', 2, (args) => services.tasks.create(args[0], args[1])),
    serviceChannel('state:get', 1, (args) => services.state.get(args[0])),
    serviceChannel('state:set', 2, (args) => services.state.set(args[0], args[1])),
    stubChannel('terminals:create', ['string', 'path'], 'stub-terminal-id'),
    stubChannel('terminals:write', ['string', 'string'], undefined),
    stubChannel('terminals:resize', ['string', 'number', 'number'], undefined),
    stubChannel('terminals:terminate', ['string'], undefined),
    // Degraded "no git" default until the real read-only parser lands (Stage 3).
    stubChannel('git:status', ['path'], { branch: null, dirty: false }),
  ]
}

/** Local structural type keeping the projects:add cast self-documenting. */
interface ProjectInfoLike {
  id: string
  name: string
  path: string
  runtimeLabel: string | null
}
