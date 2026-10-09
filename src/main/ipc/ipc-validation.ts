import { isAbsolute } from 'node:path'
import { isBottomTabId } from '../../shared/bottom-tab-id'
import type {
  ActionInput,
  AgentProfilePut,
  KanbanCreateInput,
  KanbanHandoffAvailabilityInput,
  KanbanHandoffCandidatesInput,
  KanbanLaunchTaskInput,
  KanbanUpdatePatch,
} from '../../shared/ipc-contract'
import { agentProfileFieldError, KANBAN_PRIORITIES } from '../../shared/ipc-contract'
import { AppError } from '../../shared/ipc-error'
import { wslProjectPath } from '../../shared/wsl-path'
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

function assertKanbanValues(
  value: unknown,
  label: string,
): asserts value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(label, 'must be an object')
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') {
      fail(`${label}.${key}`, 'must be a string')
    }
  }
}

function assertOptionalKanbanValues(
  value: unknown,
  label: string,
): asserts value is Record<string, string> | undefined {
  if (value === undefined) {
    return
  }
  assertKanbanValues(value, label)
}

const AGENT_PROFILE_PUT_KEYS = ['id', 'name', 'executable', 'args', 'isDefault']

function assertAgentProfilePut(value: unknown, label: string): asserts value is AgentProfilePut {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(label, 'must be an object')
  }
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  if (
    keys.length !== AGENT_PROFILE_PUT_KEYS.length ||
    keys.some((key) => !AGENT_PROFILE_PUT_KEYS.includes(key))
  ) {
    fail(label, 'has unexpected or missing fields')
  }
  if (input.id !== null) {
    assertString(input.id, `${label}.id`)
    if ((input.id as string).length === 0) fail(`${label}.id`, 'must be non-empty')
  }
  assertString(input.name, `${label}.name`)
  assertString(input.executable, `${label}.executable`)
  if (!Array.isArray(input.args)) fail(`${label}.args`, 'must be an array')
  input.args.forEach((arg, index) => {
    assertString(arg, `${label}.args[${index}]`)
  })
  if (typeof input.isDefault !== 'boolean') fail(`${label}.isDefault`, 'must be a boolean')
  const message = agentProfileFieldError({
    name: input.name as string,
    executable: input.executable as string,
    args: input.args as string[],
  })
  if (message !== null) throw new ValidationError(message)
}

function assertKanbanSetConfig(
  value: unknown,
  label: string,
): asserts value is { adapterId: string | null; values: Record<string, string> } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(label, 'must be an object')
  }
  const input = value as Record<string, unknown>
  if (input.adapterId !== null && typeof input.adapterId !== 'string') {
    fail(`${label}.adapterId`, 'must be a string or null')
  }
  assertKanbanValues(input.values, `${label}.values`)
}

function assertKanbanCreateInput(
  value: unknown,
  label: string,
): asserts value is KanbanCreateInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(label, 'must be an object')
  }
  const input = value as Record<string, unknown>
  if (typeof input.title !== 'string' || !input.title.trim()) {
    fail(`${label}.title`, 'must be non-empty')
  }
  if (input.description !== undefined && typeof input.description !== 'string') {
    fail(`${label}.description`, 'must be a string')
  }
  if (
    input.stateRef !== undefined &&
    (typeof input.stateRef !== 'string' || !input.stateRef.trim())
  ) {
    fail(`${label}.stateRef`, 'must be non-empty')
  }
  if (
    input.priority !== undefined &&
    (typeof input.priority !== 'string' || !KANBAN_PRIORITIES.includes(input.priority as never))
  ) {
    fail(`${label}.priority`, `must be one of ${KANBAN_PRIORITIES.join('|')}`)
  }
}

function assertKanbanUpdatePatch(
  value: unknown,
  label: string,
): asserts value is KanbanUpdatePatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(label, 'must be an object')
  }
  const input = value as Record<string, unknown>
  const present = Object.keys(input)
  if (present.length === 0) {
    fail(label, 'must change at least one field')
  }
  for (const key of present) {
    if (key !== 'title' && key !== 'description' && key !== 'stateRef' && key !== 'priority') {
      fail(`${label}.${key}`, 'is not a patchable field')
    }
  }
  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim())) {
    fail(`${label}.title`, 'must be non-empty')
  }
  if (input.description !== undefined && typeof input.description !== 'string') {
    fail(`${label}.description`, 'must be a string')
  }
  if (
    input.stateRef !== undefined &&
    (typeof input.stateRef !== 'string' || !input.stateRef.trim())
  ) {
    fail(`${label}.stateRef`, 'must be non-empty')
  }
  if (
    input.priority !== undefined &&
    (typeof input.priority !== 'string' || !KANBAN_PRIORITIES.includes(input.priority as never))
  ) {
    fail(`${label}.priority`, `must be one of ${KANBAN_PRIORITIES.join('|')}`)
  }
}

const LAUNCH_TASK_FIELDS = ['projectId', 'itemId', 'ref', 'profileId', 'attemptId', 'mode'] as const
const LAUNCH_TASK_RESUME_FIELDS = [...LAUNCH_TASK_FIELDS, 'fileName', 'stamp'] as const

function assertKanbanLaunchTask(
  value: unknown,
  label: string,
): asserts value is KanbanLaunchTaskInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(label, 'must be an object')
  }
  const input = value as Record<string, unknown>
  if (input.mode !== 'start' && input.mode !== 'resume') {
    fail(`${label}.mode`, 'must be "start" or "resume"')
  }
  const allowed: readonly string[] =
    input.mode === 'resume' ? LAUNCH_TASK_RESUME_FIELDS : LAUNCH_TASK_FIELDS
  const keys = Object.keys(input)
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    fail(label, 'has unexpected or missing fields')
  }
  for (const field of ['projectId', 'itemId', 'ref', 'profileId', 'attemptId'] as const) {
    const fieldValue = input[field]
    if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
      fail(`${label}.${field}`, 'must be a non-empty string')
    }
    if (fieldValue.includes('\u0000')) {
      fail(`${label}.${field}`, 'must not contain NUL characters')
    }
  }
  if (input.mode === 'resume') {
    for (const field of ['fileName', 'stamp'] as const) {
      const fieldValue = input[field]
      if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
        fail(`${label}.${field}`, 'must be a non-empty string')
      }
      if (fieldValue.includes('\u0000')) {
        fail(`${label}.${field}`, 'must not contain NUL characters')
      }
    }
    // The renderer sends a name from a scan result main just produced, never a
    // free path: a separator or a dot segment is rejected here.
    const fileName = input.fileName as string
    if (/[\\/]/.test(fileName) || fileName === '.' || fileName === '..') {
      fail(`${label}.fileName`, 'must be a file name, not a path')
    }
  }
}

const HANDOFF_CANDIDATES_FIELDS = ['projectId', 'itemId', 'ref'] as const

/** Shared projectId/itemId/ref shape for the handoff candidates channel. */
function assertHandoffIdentity(
  input: Record<string, unknown>,
  label: string,
  fields: readonly string[],
): void {
  const keys = Object.keys(input)
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    fail(label, 'has unexpected or missing fields')
  }
  for (const field of ['projectId', 'itemId', 'ref'] as const) {
    const fieldValue = input[field]
    if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
      fail(`${label}.${field}`, 'must be a non-empty string')
    }
    if ((fieldValue as string).includes('\u0000')) {
      fail(`${label}.${field}`, 'must not contain NUL characters')
    }
  }
}

function assertKanbanHandoffCandidates(
  value: unknown,
  label: string,
): asserts value is KanbanHandoffCandidatesInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(label, 'must be an object')
  }
  assertHandoffIdentity(value as Record<string, unknown>, label, HANDOFF_CANDIDATES_FIELDS)
}

const HANDOFF_AVAILABILITY_FIELDS = ['projectId', 'items'] as const
const HANDOFF_AVAILABILITY_ITEM_FIELDS = ['itemId', 'ref'] as const

/**
 * Batch handoff check body: one project id and the loaded items' identities
 * (`{ itemId, ref }`). The renderer never sends a disk path; main resolves the
 * directory from its own state. Shape only here.
 */
function assertKanbanHandoffAvailability(
  value: unknown,
  label: string,
): asserts value is KanbanHandoffAvailabilityInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(label, 'must be an object')
  }
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  if (
    keys.length !== HANDOFF_AVAILABILITY_FIELDS.length ||
    keys.some((key) => !HANDOFF_AVAILABILITY_FIELDS.includes(key as never))
  ) {
    fail(label, 'has unexpected or missing fields')
  }
  const projectId = input.projectId
  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    fail(`${label}.projectId`, 'must be a non-empty string')
  }
  if ((projectId as string).includes('\u0000')) {
    fail(`${label}.projectId`, 'must not contain NUL characters')
  }
  if (!Array.isArray(input.items)) {
    fail(`${label}.items`, 'must be an array')
  }
  input.items.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      fail(`${label}.items[${index}]`, 'must be an object')
    }
    const item = entry as Record<string, unknown>
    const itemKeys = Object.keys(item)
    if (
      itemKeys.length !== HANDOFF_AVAILABILITY_ITEM_FIELDS.length ||
      itemKeys.some((key) => !HANDOFF_AVAILABILITY_ITEM_FIELDS.includes(key as never))
    ) {
      fail(`${label}.items[${index}]`, 'has unexpected or missing fields')
    }
    for (const field of HANDOFF_AVAILABILITY_ITEM_FIELDS) {
      const fieldValue = item[field]
      if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
        fail(`${label}.items[${index}].${field}`, 'must be a non-empty string')
      }
      if ((fieldValue as string).includes('\u0000')) {
        fail(`${label}.items[${index}].${field}`, 'must not contain NUL characters')
      }
    }
  })
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

/** Optional project context preserves existing Local callers. */
function shellContextChannel(
  channel: string,
  custom: boolean,
  invoke: (args: unknown[]) => unknown,
): ValidatedChannel {
  return {
    channel,
    parse(payload) {
      const base = custom ? 1 : 0
      if (payload.length !== base && payload.length !== base + 1)
        fail(channel, 'has invalid arguments')
      if (custom) assertSafePath(payload[0], `${channel} path`)
      if (payload.length === base + 1 && payload[base] !== null)
        assertString(payload[base], `${channel} projectId`)
      return payload
    },
    invoke,
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
    serviceChannel('projects:wslDistributions', [], () => services.projects.wslDistributions()),
    {
      channel: 'projects:addWsl',
      parse(payload) {
        requireArgs(payload, 2, 'projects:addWsl')
        assertString(payload[0], 'distribution')
        assertString(payload[1], 'linuxPath')
        try {
          wslProjectPath(payload[0] as string, payload[1] as string)
        } catch {
          fail(
            'projects:addWsl',
            'requires a valid distribution and absolute Linux project directory',
          )
        }
        return payload
      },
      invoke: (args) => services.projects.addWsl(args[0] as string, args[1] as string),
    },
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
    // Chat terminals: one PTY per chat, spawned lazily on create. A failed
    // task launch owns that chat until argv is delivered; the renderer must
    // not start the project shell in its place.
    serviceChannel('terminals:create', ['string', 'path'], (args) => {
      const chatId = args[0] as string
      if (services.kanban.blocksProjectShell(chatId)) {
        throw new AppError('conflict', 'Failed to start the terminal process.', 'terminals:create')
      }
      return services.terminals.create(chatId, args[1] as string)
    }),
    serviceChannel('terminals:write', ['string', 'string'], (args) =>
      services.terminals.write(args[0], args[1]),
    ),
    serviceChannel('terminals:resize', ['string', 'number', 'number'], (args) =>
      services.terminals.resize(args[0], args[1], args[2]),
    ),
    // Shell selection (spec project-shell-selection): shellName resolves the
    // project's stored choice; shellList reads the cache (never probes);
    // shellDetect runs one explicit detection (the Shell tab calls it on
    // entry); shellAddCustom validates an absolute executable path in main.
    serviceChannel('terminals:shellName', ['string'], (args) =>
      services.terminals.shellName(args[0]),
    ),
    shellContextChannel('terminals:shellList', false, (args) =>
      args.length === 0
        ? services.terminals.shellList()
        : services.terminals.shellList(args[0] as string | null),
    ),
    shellContextChannel('terminals:shellDetect', false, (args) =>
      args.length === 0
        ? services.terminals.shellDetect()
        : services.terminals.shellDetect(args[0] as string | null),
    ),
    shellContextChannel('terminals:shellAddCustom', true, (args) =>
      args.length === 1
        ? services.terminals.shellAddCustom(args[0] as string)
        : services.terminals.shellAddCustom(args[0] as string, args[1] as string | null),
    ),
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
    // Open the registered project root in the OS file manager: one project id
    // argument, existence checked in the service (a vanished root surfaces as
    // not_found like every other rejected shape).
    serviceChannel('files:openRoot', ['string'], (args) => services.files.openRoot(args[0])),
    // Handoff directory listing (spec handoff-resume-flow): read-only, one
    // registered project id argument. The configured directory may resolve
    // outside the project root by explicit user configuration, so unlike
    // files:* there is no containment rule here.
    serviceChannel('handoffs:list', ['string'], (args) => services.handoffs.list(args[0])),
    // Kanban adapter channels (spec kanban-adapter-interface Data/API).
    // adaptersList/getConfig/setConfig are synchronous app-side operations;
    // test/listBoard/create/update invoke adapter processes (async).
    serviceChannel('kanban:adaptersList', [], () => services.kanban.adaptersList()),
    serviceChannel('kanban:getConfig', ['string'], (args) => services.kanban.getConfig(args[0])),
    {
      channel: 'kanban:setConfig',
      parse: (payload) => {
        requireArgs(payload, 2, 'kanban:setConfig')
        assertString(payload[0], 'kanban:setConfig arg[0]')
        assertKanbanSetConfig(payload[1], 'kanban:setConfig arg[1]')
        return payload
      },
      invoke: (args) =>
        services.kanban.setConfig(
          args[0] as string,
          args[1] as { adapterId: string | null; values: Record<string, string> },
        ),
    },
    {
      channel: 'kanban:test',
      parse: (payload) => {
        requireArgs(payload, 2, 'kanban:test')
        assertString(payload[0], 'kanban:test arg[0]')
        assertOptionalKanbanValues(payload[1], 'kanban:test arg[1]')
        return payload
      },
      invoke: (args) =>
        services.kanban.test(args[0] as string, args[1] as Record<string, string> | undefined),
    },
    serviceChannel('kanban:listBoard', ['string'], (args) => services.kanban.listBoard(args[0])),
    {
      channel: 'kanban:createItem',
      parse: (payload) => {
        requireArgs(payload, 2, 'kanban:createItem')
        assertString(payload[0], 'kanban:createItem arg[0]')
        assertKanbanCreateInput(payload[1], 'kanban:createItem arg[1]')
        return payload
      },
      invoke: (args) => services.kanban.createItem(args[0] as string, args[1] as KanbanCreateInput),
    },
    {
      channel: 'kanban:updateItem',
      parse: (payload) => {
        requireArgs(payload, 3, 'kanban:updateItem')
        assertString(payload[0], 'kanban:updateItem arg[0]')
        assertString(payload[1], 'kanban:updateItem arg[1]')
        assertKanbanUpdatePatch(payload[2], 'kanban:updateItem arg[2]')
        return payload
      },
      invoke: (args) =>
        services.kanban.updateItem(
          args[0] as string,
          args[1] as string,
          args[2] as KanbanUpdatePatch,
        ),
    },
    {
      channel: 'kanban:getItem',
      parse: (payload) => {
        requireArgs(payload, 2, 'kanban:getItem')
        assertString(payload[0], 'kanban:getItem arg[0]')
        assertString(payload[1], 'kanban:getItem arg[1]')
        if ((payload[0] as string).length === 0 || (payload[1] as string).length === 0) {
          fail('kanban:getItem', 'requires non-empty projectId and ref')
        }
        return payload
      },
      invoke: (args) => services.kanban.getItem(args[0] as string, args[1] as string),
    },
    {
      channel: 'kanban:launchTask',
      parse: (payload) => {
        requireArgs(payload, 1, 'kanban:launchTask')
        assertKanbanLaunchTask(payload[0], 'kanban:launchTask')
        return payload
      },
      invoke: (args) => services.kanban.launchTask(args[0] as KanbanLaunchTaskInput),
    },
    {
      channel: 'kanban:handoffCandidates',
      parse: (payload) => {
        requireArgs(payload, 1, 'kanban:handoffCandidates')
        assertKanbanHandoffCandidates(payload[0], 'kanban:handoffCandidates')
        return payload
      },
      invoke: (args) => services.kanban.handoffCandidates(args[0] as KanbanHandoffCandidatesInput),
    },
    {
      channel: 'kanban:handoffAvailability',
      parse: (payload) => {
        requireArgs(payload, 1, 'kanban:handoffAvailability')
        assertKanbanHandoffAvailability(payload[0], 'kanban:handoffAvailability')
        return payload
      },
      invoke: (args) =>
        services.kanban.handoffAvailability(args[0] as KanbanHandoffAvailabilityInput),
    },
    serviceChannel('agentProfiles:get', ['string'], (args) => services.agentProfiles.get(args[0])),
    {
      channel: 'agentProfiles:put',
      parse: (payload) => {
        requireArgs(payload, 2, 'agentProfiles:put')
        assertString(payload[0], 'agentProfiles:put arg[0]')
        assertAgentProfilePut(payload[1], 'agentProfiles:put arg[1]')
        return payload
      },
      invoke: (args) => services.agentProfiles.put(args[0] as string, args[1] as AgentProfilePut),
    },
    {
      channel: 'agentProfiles:delete',
      parse: (payload) => {
        requireArgs(payload, 2, 'agentProfiles:delete')
        assertString(payload[0], 'agentProfiles:delete arg[0]')
        assertString(payload[1], 'agentProfiles:delete arg[1]')
        if ((payload[1] as string).length === 0) {
          fail('agentProfiles:delete arg[1]', 'must be non-empty')
        }
        return payload
      },
      invoke: (args) => services.agentProfiles.delete(args[0] as string, args[1] as string),
    },
    {
      channel: 'dialogs:pickDirectory',
      parse: (payload) => {
        requireArgs(payload, 1, 'dialogs:pickDirectory')
        if (payload[0] !== null) {
          assertSafePath(payload[0], 'dialogs:pickDirectory defaultPath')
        }
        return payload
      },
      invoke: (args) => services.dialogs.pickDirectory(args[0] as string | null),
    },
  ]
}

/** Local structural type keeping the projects:add cast self-documenting. */
interface ProjectInfoLike {
  id: string
  name: string
  path: string
  runtimeLabel: string | null
}
