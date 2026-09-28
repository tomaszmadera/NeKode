import { isAbsolute } from 'node:path'
import { isBottomTabId } from '../../shared/bottom-tab-id'
import type { ActionInput } from '../../shared/ipc-contract'
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

/**
 * Project-relative path arguments (files:*). Shape only: a non-empty string
 * without NUL bytes. Traversal (`..`), absolute inputs and symlinks leaving
 * the project root are containment violations handled by the file service —
 * they must surface as the not-found error, never as a validation error
 * (spec AC7: indistinguishable from "not found").
 */
const assertRelativePath: Validator = (value, label) => {
  assertString(value, label)
  const path = value as string
  if (path.includes('\u0000')) {
    fail(label, 'must not contain NUL characters')
  }
  if (path.length === 0) {
    fail(label, 'must be a non-empty relative path')
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

function assertActionInput(value: unknown, label: string): asserts value is ActionInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(label, 'must be an action object')
  const input = value as Record<string, unknown>
  const keys = [
    'scope',
    'projectId',
    'title',
    'icon',
    'command',
    'cwd',
    'runMode',
    'confirm',
    'sortOrder',
  ]
  if (
    Object.keys(input).length !== keys.length ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    fail(label, 'has unexpected or missing fields')
  if (input.scope !== 'global' && input.scope !== 'project') fail(`${label}.scope`, 'is invalid')
  if (input.projectId !== null) assertString(input.projectId, `${label}.projectId`)
  if (typeof input.title !== 'string' || !input.title.trim())
    fail(`${label}.title`, 'must be non-empty')
  if (input.icon !== null) assertString(input.icon, `${label}.icon`)
  if (typeof input.command !== 'string' || !input.command.trim())
    fail(`${label}.command`, 'must be non-empty')
  if (input.cwd !== null) assertSafePath(input.cwd, `${label}.cwd`)
  if (
    input.runMode !== 'background' &&
    input.runMode !== 'new-terminal' &&
    input.runMode !== 'bottom-terminal'
  )
    fail(`${label}.runMode`, 'is invalid')
  if (typeof input.confirm !== 'boolean') fail(`${label}.confirm`, 'must be a boolean')
  if (typeof input.sortOrder !== 'number' || !Number.isSafeInteger(input.sortOrder))
    fail(`${label}.sortOrder`, 'must be an integer')
  if ((input.scope === 'project') !== (input.projectId !== null))
    fail(label, 'has inconsistent scope and projectId')
}

function actionInputChannel(
  channel: string,
  withId: boolean,
  invokeService: (id: string | null, input: ActionInput) => unknown,
): ValidatedChannel {
  return {
    channel,
    parse: (payload) => {
      requireArgs(payload, withId ? 2 : 1, channel)
      if (withId) assertString(payload[0], `${channel} arg[0]`)
      const input = payload[withId ? 1 : 0]
      assertActionInput(input, `${channel} input`)
      return withId ? [payload[0], input] : [input]
    },
    invoke: (args) =>
      invokeService(withId ? (args[0] as string) : null, args[withId ? 1 : 0] as ActionInput),
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
type ArgType = 'string' | 'number' | 'path' | 'relativePath' | 'relativePath?'

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
        } else if (type === 'relativePath') {
          assertRelativePath(payload[index], label)
        } else if (type === 'relativePath?') {
          if (payload[index] !== null) {
            assertRelativePath(payload[index], label)
          }
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
    serviceChannel('actions:list', [], () => services.actions.list()),
    actionInputChannel('actions:create', false, (_, input) => services.actions.create(input)),
    actionInputChannel('actions:update', true, (id, input) =>
      services.actions.update(id as string, input),
    ),
    serviceChannel('actions:delete', ['string'], (args) => services.actions.delete(args[0])),
    {
      channel: 'actions:execute',
      parse: (payload) => {
        requireArgs(payload, 3, 'actions:execute')
        assertString(payload[0], 'actions:execute id')
        if (payload[1] !== null) assertString(payload[1], 'actions:execute projectId')
        if (typeof payload[2] !== 'boolean') fail('actions:execute confirmed', 'must be a boolean')
        return payload
      },
      invoke: (args) =>
        services.actions.execute(args[0] as string, args[1] as string | null, args[2] as boolean),
    },
    serviceChannel('actions:status', ['string'], (args) => services.actions.status(args[0])),
    serviceChannel('projects:list', [], () => services.projects.list()),
    // The Add Project flow opens the native dialog in main (ipc-handlers);
    // the channel payload is empty and the path comes from the dialog.
    serviceChannel('projects:add', [], () =>
      (services.projects.add as (path?: string) => ProjectInfoLike)(),
    ),
    serviceChannel('projects:remove', ['string'], (args) => services.projects.remove(args[0])),
    serviceChannel('chats:list', ['string'], (args) => services.chats.list(args[0])),
    // No name payload: the chat name is derived from the platform shell in
    // main (spec Behaviour 3) and duplicates within a project are allowed.
    serviceChannel('chats:create', ['string'], (args) => services.chats.create(args[0])),
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
    serviceChannel('terminals:shellName', [], () => services.terminals.shellName()),
    {
      channel: 'terminals:terminate',
      parse: (payload) => {
        requireArgs(payload, 1, 'terminals:terminate')
        assertString(payload[0], 'terminals:terminate arg[0]')
        const sessionId = payload[0] as string
        if (!isBottomTabId(sessionId)) {
          throw new ValidationError('terminals:terminate arg[0] must be a bottom tab id')
        }
        return payload
      },
      invoke: (args) => services.terminals.terminate(args[0] as string),
    },
    // Read-only git status; failures degrade to "no git" inside the service.
    serviceChannel('git:status', ['path'], (args) => services.git.getStatus(args[0])),
    // Project files (spec Data/API): read-only tree listing, preview
    // classification and the single OS action (openExternal). Relative-path
    // shape is validated here; containment (`..`, absolute, symlinks leaving
    // the root) is enforced by the service and surfaces as not_found.
    serviceChannel('files:list', ['string', 'relativePath?'], (args) =>
      services.files.list(args[0], args[1] as string | null),
    ),
    serviceChannel('files:read', ['string', 'relativePath'], (args) =>
      services.files.read(args[0], args[1]),
    ),
    serviceChannel('files:openExternal', ['string', 'relativePath'], (args) =>
      services.files.openExternal(args[0], args[1]),
    ),
  ]
}

/** Local structural type keeping the projects:add cast self-documenting. */
interface ProjectInfoLike {
  id: string
  name: string
  path: string
  runtimeLabel: string | null
}
