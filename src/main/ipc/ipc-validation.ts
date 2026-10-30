import { isBottomTabId } from '@shared/bottom-tab-id'
import { type ActionInput, actionInputSchema } from '@shared/contracts/actions-schema'
import {
  type AgentProfilePut,
  type AgentProjectSelectionInput,
  agentIdSchema,
  agentProfilePutSchema,
  agentProjectSelectionInputSchema,
} from '@shared/contracts/agent-profiles-schema'
import {
  type DesktopDictationSettings,
  isDesktopDictationSettings,
} from '@shared/contracts/desktop-dictation-contract'
import {
  type DictationSettings,
  isDictationSettings,
  isDictationWav,
} from '@shared/contracts/dictation-contract'
import {
  type CreateDictionaryEntryInput,
  createDictionaryEntryInputSchema,
  providerConfigSchema,
  type SetPostProcessingSettingsInput,
  setPostProcessingSettingsInputSchema,
  type UpdateDictionaryEntryInput,
  updateDictionaryEntryInputSchema,
} from '@shared/contracts/dictation-schema'
import {
  type KanbanCreateInput,
  type KanbanLaunchTaskInput,
  type KanbanSetConfigInput,
  type KanbanUpdatePatch,
  kanbanCreateInputSchema,
  kanbanLaunchTaskInputSchema,
  kanbanSetConfigInputSchema,
  kanbanUpdatePatchSchema,
} from '@shared/contracts/kanban-schema'
import {
  resumeIdSchema,
  resumeRevisionSchema,
  resumeSourcePutSchema,
  resumeTokenSchema,
} from '@shared/contracts/resume-sources-schema'
import { BARE_MESSAGE, safePathSchema, stringValuesSchema } from '@shared/contracts/schema-rules'
import { parseUsageSettings, type UsageConnection } from '@shared/contracts/usage-contract'
import {
  IPC_CHANNEL,
  isResumeSourcesStateKey,
  isSecretStateKey,
  isTaskProgressStateKey,
} from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { wslProjectPath } from '@shared/wsl-path'
import type { z } from 'zod'
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

/** Absolute path without NUL or '..' segments; the rule lives in `safePathSchema`. */
const assertSafePath: Validator = (value, label) => {
  parsePayload(safePathSchema, value, label)
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

const assertStateKey: Validator = (value, label) => {
  assertString(value, label)
  if (
    isSecretStateKey(value as string) ||
    isTaskProgressStateKey(value as string) ||
    isResumeSourcesStateKey(value as string)
  ) {
    fail(label, 'is a protected key')
  }
}

/** Upper bound for the visible project set of taskProgress:observe. */
const MAX_OBSERVED_PROJECTS = 1000

function fail(label: string, rule: string): never {
  throw new ValidationError(`${label} ${rule}`)
}

/**
 * Runs a payload schema. The first issue becomes a ValidationError labelled
 * like the hand-written checks it replaced (`<label><path> <rule>`); an issue
 * marked `BARE_MESSAGE` is a complete sentence and is reported as is. The
 * schemas carry no transforms, so the validated input passes through unchanged.
 */
function parsePayload<S extends z.ZodType>(schema: S, value: unknown, label: string): z.output<S> {
  const result = schema.safeParse(value)
  if (result.success) return value as z.output<S>
  const issue = result.error.issues[0]
  if (issue.code === 'custom' && issue.params?.bare === BARE_MESSAGE.bare) {
    throw new ValidationError(issue.message)
  }
  const path = issue.path
    .map((segment) => (typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`))
    .join('')
  throw new ValidationError(`${label}${path} ${issue.message}`)
}

function requireArgs(payload: unknown[], count: number, channel: string): void {
  if (payload.length !== count) {
    throw new ValidationError(`${channel}: expected ${count} argument(s), got ${payload.length}`)
  }
}

/** Adapter ids are kebab-case manifest ids; anything else never names an adapter. */
function assertAdapterId(value: unknown, label: string): asserts value is string {
  assertString(value, label)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value as string)) {
    fail(label, 'must be a kebab-case adapter id')
  }
}

/** `local-file` document revision: absent, or a positive safe integer. */
function assertOptionalRevision(
  value: unknown,
  label: string,
): asserts value is number | undefined {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    fail(label, 'must be a positive integer')
  }
}

/** Arity with one optional trailing argument (the `local-file` revision). */
function requireArgsWithOptional(payload: unknown[], count: number, channel: string): void {
  if (payload.length !== count && payload.length !== count + 1) {
    throw new ValidationError(
      `${channel}: expected ${count} or ${count + 1} argument(s), got ${payload.length}`,
    )
  }
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
      parsePayload(actionInputSchema, input, `${channel} input`)
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
type ArgType = 'string' | 'stateKey' | 'number' | 'path' | 'relativePath' | 'relativePath?'

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
        } else if (type === 'stateKey') {
          assertStateKey(payload[index], label)
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
    serviceChannel(IPC_CHANNEL.appUpdateLatest, [], () => services.appUpdate.latest()),
    serviceChannel(IPC_CHANNEL.appUpdateDownload, [], () => services.appUpdate.download()),
    serviceChannel(IPC_CHANNEL.appUpdateLaunch, [], () => services.appUpdate.launch()),
    serviceChannel(IPC_CHANNEL.usageListAdapters, [], () => services.usage.listAdapters()),
    serviceChannel(IPC_CHANNEL.usageGetSettings, [], () => services.usage.getSettings()),
    serviceChannel(IPC_CHANNEL.usageRead, [], () => services.usage.read()),
    serviceChannel(IPC_CHANNEL.usageRefresh, [], () => services.usage.refresh()),
    {
      channel: IPC_CHANNEL.usageSaveSettings,
      parse(payload) {
        requireArgs(payload, 1, IPC_CHANNEL.usageSaveSettings)
        return [parseUsageSettings(payload[0])]
      },
      invoke: (args) =>
        services.usage.saveSettings(args[0] as ReturnType<typeof parseUsageSettings>),
    },
    {
      channel: IPC_CHANNEL.usageTest,
      parse(payload) {
        requireArgs(payload, 1, IPC_CHANNEL.usageTest)
        const s = parseUsageSettings({
          connections: [payload[0]],
          pin: null,
          export: { enabled: false, path: null },
        })
        return [s.connections[0]]
      },
      invoke: (args) => services.usage.test(args[0] as UsageConnection),
    },
    {
      channel: IPC_CHANNEL.usagePickFile,
      parse(payload) {
        requireArgs(payload, 1, IPC_CHANNEL.usagePickFile)
        if (typeof payload[0] !== 'boolean') fail('usage output', 'must be boolean')
        return payload
      },
      invoke: (args) => services.usage.pickFile(args[0] as boolean),
    },
    serviceChannel(IPC_CHANNEL.usageGetEnabled, [], () => services.usage.getEnabled()),
    {
      channel: IPC_CHANNEL.usageSetEnabled,
      parse(payload) {
        requireArgs(payload, 1, IPC_CHANNEL.usageSetEnabled)
        if (typeof payload[0] !== 'boolean') fail('usage switch', 'must be boolean')
        return payload
      },
      invoke: (args) => services.usage.setEnabled(args[0] as boolean),
    },
    serviceChannel(IPC_CHANNEL.usageOpenAdaptersFolder, [], () =>
      services.usage.openAdaptersFolder(),
    ),
    serviceChannel(IPC_CHANNEL.dictationStatus, [], () => services.dictation.status()),
    serviceChannel(IPC_CHANNEL.dictationDesktopSetup, [], () => services.dictation.desktopSetup()),
    // The handler derives the window identity after sender and payload validation.
    serviceChannel(IPC_CHANNEL.dictationDesktopActivate, [], () => undefined),
    {
      channel: IPC_CHANNEL.dictationDesktopConfigure,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.dictationDesktopConfigure)
        if (!isDesktopDictationSettings(payload[0]))
          fail(IPC_CHANNEL.dictationDesktopConfigure, 'has invalid desktop settings')
        return payload
      },
      invoke: (args) => services.dictation.desktopConfigure(args[0] as DesktopDictationSettings),
    },
    serviceChannel(IPC_CHANNEL.dictationTestConnection, [], () =>
      services.dictation.testConnection(),
    ),
    serviceChannel(IPC_CHANNEL.dictationRefreshModels, [], () =>
      services.dictation.refreshModels(),
    ),
    serviceChannel(IPC_CHANNEL.dictationGetSettings, [], () => services.dictation.getSettings()),
    {
      channel: IPC_CHANNEL.dictationDictionaryList,
      parse: (payload) => {
        requireArgsWithOptional(payload, 0, IPC_CHANNEL.dictationDictionaryList)
        if (payload.length === 1 && payload[0] !== undefined) {
          assertString(payload[0], 'dictation:dictionaryList projectId')
        }
        return payload
      },
      invoke: (args) =>
        args.length > 0
          ? services.dictation.dictionaryList(args[0] as string)
          : services.dictation.dictionaryList(),
    },
    serviceChannel(IPC_CHANNEL.dictationProvidersList, [], () =>
      services.dictation.providersList(),
    ),
    {
      channel: IPC_CHANNEL.dictationProvidersTestConnection,
      parse: (payload) => {
        requireArgsWithOptional(payload, 1, IPC_CHANNEL.dictationProvidersTestConnection)
        assertString(payload[0], 'dictation:providersTestConnection providerId')
        if (!(payload[0] as string).trim())
          fail(IPC_CHANNEL.dictationProvidersTestConnection, 'requires a providerId')
        if (payload.length === 2 && payload[1] !== undefined) {
          parsePayload(providerConfigSchema, payload[1], 'dictation:providersTestConnection config')
        }
        return payload
      },
      invoke: (args) =>
        services.dictation.providersTestConnection(
          args[0] as string,
          args[1] as Record<string, unknown> | undefined,
        ),
    },
    {
      channel: IPC_CHANNEL.dictationProvidersDiscoverModels,
      parse: (payload) => {
        requireArgsWithOptional(payload, 1, IPC_CHANNEL.dictationProvidersDiscoverModels)
        assertString(payload[0], 'dictation:providersDiscoverModels providerId')
        if (!(payload[0] as string).trim())
          fail(IPC_CHANNEL.dictationProvidersDiscoverModels, 'requires a providerId')
        if (payload.length === 2 && payload[1] !== undefined) {
          parsePayload(providerConfigSchema, payload[1], 'dictation:providersDiscoverModels config')
        }
        return payload
      },
      invoke: (args) =>
        services.dictation.providersDiscoverModels(
          args[0] as string,
          args[1] as Record<string, unknown> | undefined,
        ),
    },
    {
      channel: IPC_CHANNEL.dictationProvidersGetConfig,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.dictationProvidersGetConfig)
        assertString(payload[0], 'dictation:providersGetConfig providerId')
        if (!(payload[0] as string).trim())
          fail(IPC_CHANNEL.dictationProvidersGetConfig, 'requires a providerId')
        return payload
      },
      invoke: (args) => services.dictation.providersGetConfig(args[0] as string),
    },
    {
      channel: IPC_CHANNEL.dictationProvidersSetConfig,
      parse: (payload) => {
        requireArgs(payload, 2, IPC_CHANNEL.dictationProvidersSetConfig)
        assertString(payload[0], 'dictation:providersSetConfig providerId')
        if (!(payload[0] as string).trim())
          fail(IPC_CHANNEL.dictationProvidersSetConfig, 'requires a providerId')
        parsePayload(providerConfigSchema, payload[1], 'dictation:providersSetConfig config')
        return payload
      },
      invoke: (args) =>
        services.dictation.providersSetConfig(
          args[0] as string,
          args[1] as Record<string, unknown>,
        ),
    },
    serviceChannel(IPC_CHANNEL.dictationGetActiveProvider, [], () =>
      services.dictation.getActiveProvider(),
    ),
    {
      channel: IPC_CHANNEL.dictationSetActiveProvider,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.dictationSetActiveProvider)
        assertString(payload[0], 'dictation:setActiveProvider providerId')
        if (!(payload[0] as string).trim())
          fail(IPC_CHANNEL.dictationSetActiveProvider, 'requires a providerId')
        return payload
      },
      invoke: (args) => services.dictation.setActiveProvider(args[0] as string),
    },
    {
      channel: IPC_CHANNEL.dictationDictionaryAdd,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.dictationDictionaryAdd)
        parsePayload(
          createDictionaryEntryInputSchema,
          payload[0],
          IPC_CHANNEL.dictationDictionaryAdd,
        )
        return payload
      },
      invoke: (args) => services.dictation.dictionaryAdd(args[0] as CreateDictionaryEntryInput),
    },
    {
      channel: IPC_CHANNEL.dictationDictionaryUpdate,
      parse: (payload) => {
        requireArgs(payload, 2, IPC_CHANNEL.dictationDictionaryUpdate)
        assertString(payload[0], 'dictation:dictionaryUpdate id')
        if (!(payload[0] as string).trim())
          fail(IPC_CHANNEL.dictationDictionaryUpdate, 'requires an id')
        parsePayload(
          updateDictionaryEntryInputSchema,
          payload[1],
          IPC_CHANNEL.dictationDictionaryUpdate,
        )
        return payload
      },
      invoke: (args) =>
        services.dictation.dictionaryUpdate(
          args[0] as string,
          args[1] as UpdateDictionaryEntryInput,
        ),
    },
    {
      channel: IPC_CHANNEL.dictationDictionaryDelete,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.dictationDictionaryDelete)
        assertString(payload[0], 'dictation:dictionaryDelete id')
        if (!(payload[0] as string).trim())
          fail(IPC_CHANNEL.dictationDictionaryDelete, 'requires an id')
        return payload
      },
      invoke: (args) => services.dictation.dictionaryDelete(args[0] as string),
    },
    {
      channel: IPC_CHANNEL.dictationDictionaryToggle,
      parse: (payload) => {
        requireArgs(payload, 2, IPC_CHANNEL.dictationDictionaryToggle)
        assertString(payload[0], 'dictation:dictionaryToggle id')
        if (!(payload[0] as string).trim())
          fail(IPC_CHANNEL.dictationDictionaryToggle, 'requires an id')
        if (typeof payload[1] !== 'boolean')
          fail(IPC_CHANNEL.dictationDictionaryToggle, 'enabled must be a boolean')
        return payload
      },
      invoke: (args) => services.dictation.dictionaryToggle(args[0] as string, args[1] as boolean),
    },
    serviceChannel(IPC_CHANNEL.dictationPostProcessingGetSettings, [], () =>
      services.dictation.postProcessingGetSettings(),
    ),
    {
      channel: IPC_CHANNEL.dictationPostProcessingSetSettings,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.dictationPostProcessingSetSettings)
        parsePayload(
          setPostProcessingSettingsInputSchema,
          payload[0],
          IPC_CHANNEL.dictationPostProcessingSetSettings,
        )
        return payload
      },
      invoke: (args) =>
        services.dictation.postProcessingSetSettings(args[0] as SetPostProcessingSettingsInput),
    },
    {
      channel: IPC_CHANNEL.dictationStart,
      parse: (payload) => {
        requireArgs(payload, 2, IPC_CHANNEL.dictationStart)
        assertString(payload[0], 'dictation:start chatId')
        if (!payload[0]) fail(IPC_CHANNEL.dictationStart, 'requires a chatId')
        if (payload[1] !== null) assertString(payload[1], 'dictation:start retrySessionId')
        return payload
      },
      invoke: (args) => services.dictation.start(args[0] as string, args[1] as string | null),
    },
    {
      channel: IPC_CHANNEL.dictationAudio,
      parse: (payload) => {
        requireArgs(payload, 2, IPC_CHANNEL.dictationAudio)
        assertString(payload[0], 'dictation:audio sessionId')
        if (!isDictationWav(payload[1]))
          fail(IPC_CHANNEL.dictationAudio, 'requires mono 16 kHz PCM WAV')
        return payload
      },
      invoke: (args) => services.dictation.audio(args[0] as string, args[1] as ArrayBuffer),
    },
    serviceChannel(IPC_CHANNEL.dictationCancel, ['string'], (args) =>
      services.dictation.cancel(args[0]),
    ),
    {
      channel: IPC_CHANNEL.dictationSetSettings,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.dictationSetSettings)
        if (!isDictationSettings(payload[0]))
          fail(IPC_CHANNEL.dictationSetSettings, 'has invalid settings')
        return payload
      },
      invoke: (args) => services.dictation.setSettings(args[0] as DictationSettings),
    },
    serviceChannel(IPC_CHANNEL.actionsList, [], () => services.actions.list()),
    actionInputChannel(IPC_CHANNEL.actionsCreate, false, (_, input) =>
      services.actions.create(input),
    ),
    actionInputChannel(IPC_CHANNEL.actionsUpdate, true, (id, input) =>
      services.actions.update(id as string, input),
    ),
    serviceChannel(IPC_CHANNEL.actionsDelete, ['string'], (args) =>
      services.actions.delete(args[0]),
    ),
    {
      channel: IPC_CHANNEL.actionsExecute,
      parse: (payload) => {
        requireArgs(payload, 3, IPC_CHANNEL.actionsExecute)
        assertString(payload[0], `${IPC_CHANNEL.actionsExecute} id`)
        if (payload[1] !== null) assertString(payload[1], `${IPC_CHANNEL.actionsExecute} projectId`)
        if (typeof payload[2] !== 'boolean')
          fail(`${IPC_CHANNEL.actionsExecute} confirmed`, 'must be a boolean')
        return payload
      },
      invoke: (args) =>
        services.actions.execute(args[0] as string, args[1] as string | null, args[2] as boolean),
    },
    serviceChannel(IPC_CHANNEL.actionsStatus, ['string'], (args) =>
      services.actions.status(args[0]),
    ),
    serviceChannel(IPC_CHANNEL.projectsList, [], () => services.projects.list()),
    serviceChannel(IPC_CHANNEL.projectsWslDistributions, [], () =>
      services.projects.wslDistributions(),
    ),
    serviceChannel(IPC_CHANNEL.projectsWslDirectories, ['string', 'string'], (args) =>
      services.projects.wslDirectories(args[0], args[1]),
    ),
    {
      channel: IPC_CHANNEL.projectsAddWsl,
      parse(payload) {
        requireArgs(payload, 2, IPC_CHANNEL.projectsAddWsl)
        assertString(payload[0], 'distribution')
        assertString(payload[1], 'linuxPath')
        try {
          wslProjectPath(payload[0] as string, payload[1] as string)
        } catch {
          fail(
            IPC_CHANNEL.projectsAddWsl,
            'requires a valid distribution and absolute Linux project directory',
          )
        }
        return payload
      },
      invoke: (args) => services.projects.addWsl(args[0] as string, args[1] as string),
    },
    // The Add Project flow opens the native dialog in main (ipc-handlers);
    // the channel payload is empty and the path comes from the dialog.
    // The entry's invoke is unreachable through normal routing; throwing protects
    // against accidental invocation without a dialog-chosen path.
    {
      channel: IPC_CHANNEL.projectsAdd,
      parse: (payload) => {
        requireArgs(payload, 0, IPC_CHANNEL.projectsAdd)
        return payload
      },
      invoke: () => {
        throw new AppError(
          'validation',
          `${IPC_CHANNEL.projectsAdd} must be routed through the folder dialog handler`,
          IPC_CHANNEL.projectsAdd,
        )
      },
    },
    serviceChannel(IPC_CHANNEL.projectsRemove, ['string'], (args) =>
      services.projects.remove(args[0]),
    ),
    serviceChannel(IPC_CHANNEL.chatsList, ['string'], (args) => services.chats.list(args[0])),
    // No name payload: the chat name is derived from the platform shell in
    // main (spec Behaviour 3) and duplicates within a project are allowed.
    serviceChannel(IPC_CHANNEL.chatsCreate, ['string'], (args) => services.chats.create(args[0])),
    // Agent chat launch (spec new-chat-agent-menu Data/API): the profile choice
    // is an AgentProfile.id; main owns the name and the agent process. A failed
    // spawn removes the chat again, so no chat id reaches the renderer.
    {
      channel: IPC_CHANNEL.chatsCreateWithAgent,
      parse: (payload) => {
        requireArgs(payload, 2, IPC_CHANNEL.chatsCreateWithAgent)
        assertString(payload[0], `${IPC_CHANNEL.chatsCreateWithAgent} arg[0]`)
        assertString(payload[1], `${IPC_CHANNEL.chatsCreateWithAgent} arg[1]`)
        if ((payload[0] as string).length === 0 || (payload[1] as string).length === 0) {
          fail(IPC_CHANNEL.chatsCreateWithAgent, 'requires non-empty projectId and profileId')
        }
        return payload
      },
      invoke: (args) => services.chats.createWithAgent(args[0] as string, args[1] as string),
    },
    // Terminal-exit close flow (spec Behaviour 11): the renderer-driven chat
    // removal; never invoked on application quit.
    serviceChannel(IPC_CHANNEL.chatsRemove, ['string'], (args) => services.chats.remove(args[0])),
    serviceChannel(IPC_CHANNEL.stateGet, ['stateKey'], (args) => services.state.get(args[0])),
    serviceChannel(IPC_CHANNEL.stateSet, ['stateKey', 'string'], (args) =>
      services.state.set(args[0], args[1]),
    ),
    // Chat terminals: one PTY per chat, spawned lazily on create. A failed
    // task launch owns that chat until argv is delivered; the renderer must
    // not start the project shell in its place.
    serviceChannel(IPC_CHANNEL.terminalsCreate, ['string', 'path'], (args) => {
      const chatId = args[0] as string
      if (services.kanban.blocksProjectShell(chatId)) {
        throw new AppError(
          'conflict',
          'Failed to start the terminal process.',
          IPC_CHANNEL.terminalsCreate,
        )
      }
      return services.terminals.create(chatId, args[1] as string)
    }),
    serviceChannel(IPC_CHANNEL.terminalsWrite, ['string', 'string'], (args) =>
      services.terminals.write(args[0], args[1]),
    ),
    serviceChannel(IPC_CHANNEL.terminalsResize, ['string', 'number', 'number'], (args) =>
      services.terminals.resize(args[0], args[1], args[2]),
    ),
    // Shell selection (spec project-shell-selection): shellName resolves the
    // project's stored choice; shellList reads the cache (never probes);
    // shellDetect runs one explicit detection (the Shell tab calls it on
    // entry); shellAddCustom validates an absolute executable path in main.
    serviceChannel(IPC_CHANNEL.terminalsShellName, ['string'], (args) =>
      services.terminals.shellName(args[0]),
    ),
    shellContextChannel(IPC_CHANNEL.terminalsShellList, false, (args) =>
      args.length === 0
        ? services.terminals.shellList()
        : services.terminals.shellList(args[0] as string | null),
    ),
    shellContextChannel(IPC_CHANNEL.terminalsShellDetect, false, (args) =>
      args.length === 0
        ? services.terminals.shellDetect()
        : services.terminals.shellDetect(args[0] as string | null),
    ),
    shellContextChannel(IPC_CHANNEL.terminalsShellAddCustom, true, (args) =>
      args.length === 1
        ? services.terminals.shellAddCustom(args[0] as string)
        : services.terminals.shellAddCustom(args[0] as string, args[1] as string | null),
    ),
    {
      channel: IPC_CHANNEL.terminalsTerminate,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.terminalsTerminate)
        assertString(payload[0], `${IPC_CHANNEL.terminalsTerminate} arg[0]`)
        const sessionId = payload[0] as string
        if (!isBottomTabId(sessionId)) {
          throw new ValidationError(
            `${IPC_CHANNEL.terminalsTerminate} arg[0] must be a bottom tab id`,
          )
        }
        return payload
      },
      invoke: (args) => services.terminals.terminate(args[0] as string),
    },
    // Read-only git status; failures degrade to "no git" inside the service.
    serviceChannel(IPC_CHANNEL.gitStatus, ['string'], (args) => services.git.getStatus(args[0])),
    // Per-path status for the file-tree decoration (NEKODE-31): resolves
    // via registered projectId; a failure degrades to {}.
    serviceChannel(IPC_CHANNEL.gitFileStatuses, ['string'], (args) =>
      services.git.fileStatuses(args[0]),
    ),
    serviceChannel(IPC_CHANNEL.gitSync, ['string'], (args) => services.git.sync(args[0])),
    // Project files (spec Data/API): read-only tree listing, preview
    // classification and the single OS action (openExternal). Relative-path
    // shape is validated here; containment (`..`, absolute, symlinks leaving
    // the root) is enforced by the service and surfaces as not_found.
    serviceChannel(IPC_CHANNEL.filesList, ['string', 'relativePath?'], (args) =>
      services.files.list(args[0], args[1] as string | null),
    ),
    serviceChannel(IPC_CHANNEL.filesRead, ['string', 'relativePath'], (args) =>
      services.files.read(args[0], args[1]),
    ),
    serviceChannel(IPC_CHANNEL.filesOpenExternal, ['string', 'relativePath'], (args) =>
      services.files.openExternal(args[0], args[1]),
    ),
    // Open the registered project root in the OS file manager: one project id
    // argument, existence checked in the service (a vanished root surfaces as
    // not_found like every other rejected shape).
    serviceChannel(IPC_CHANNEL.filesOpenRoot, ['string'], (args) =>
      services.files.openRoot(args[0]),
    ),
    serviceChannel(IPC_CHANNEL.filesShowInFolder, ['string', 'relativePath'], (args) =>
      services.files.showInFolder(args[0], args[1]),
    ),
    serviceChannel(IPC_CHANNEL.filesTrash, ['string', 'relativePath'], (args) =>
      services.files.trash(args[0], args[1]),
    ),
    serviceChannel(IPC_CHANNEL.resumeSourcesList, [], () => services.resumeSources.list()),
    {
      channel: IPC_CHANNEL.resumeSourcesPut,
      parse: (args) => {
        requireArgs(args, 1, IPC_CHANNEL.resumeSourcesPut)
        parsePayload(resumeSourcePutSchema, args[0], 'template')
        return args
      },
      invoke: (args) =>
        services.resumeSources.put(args[0] as import('@shared/ipc-contract').ResumeSourcePut),
    },
    ...([IPC_CHANNEL.resumeSourcesDuplicate, IPC_CHANNEL.resumeSourcesDelete] as const).map(
      (channel) => ({
        channel,
        parse: (args: unknown[]) => {
          requireArgs(args, 2, channel)
          parsePayload(resumeIdSchema, args[0], 'templateId')
          parsePayload(resumeRevisionSchema, args[1], 'revision')
          return args
        },
        invoke: (args: unknown[]) =>
          channel === IPC_CHANNEL.resumeSourcesDelete
            ? services.resumeSources.delete(args[0] as string, args[1] as number)
            : services.resumeSources.duplicate(args[0] as string, args[1] as number),
      }),
    ),
    {
      channel: IPC_CHANNEL.resumeSourcesTest,
      parse: (args) => {
        requireArgs(args, 4, IPC_CHANNEL.resumeSourcesTest)
        parsePayload(resumeIdSchema, args[0], 'templateId')
        parsePayload(resumeIdSchema, args[1], 'projectId')
        parsePayload(resumeRevisionSchema, args[2], 'revision')
        parsePayload(resumeIdSchema, args[3], 'requestId')
        return args
      },
      invoke: (args) =>
        services.resumeSources.test(
          args[0] as string,
          args[1] as string,
          args[2] as number,
          args[3] as string,
        ),
    },
    {
      channel: IPC_CHANNEL.resumeSourcesCancel,
      parse: (args) => {
        requireArgs(args, 1, IPC_CHANNEL.resumeSourcesCancel)
        parsePayload(resumeIdSchema, args[0], 'requestId')
        return args
      },
      invoke: (args) => services.resumeSources.cancel(args[0] as string),
    },
    {
      channel: IPC_CHANNEL.resumeSourcesBind,
      parse: (args) => {
        requireArgs(args, 2, IPC_CHANNEL.resumeSourcesBind)
        parsePayload(resumeIdSchema, args[0], 'projectId')
        parsePayload(resumeIdSchema.nullable(), args[1], 'templateId')
        return args
      },
      invoke: (args) => services.resumeSources.bind(args[0] as string, args[1] as string | null),
    },
    {
      channel: IPC_CHANNEL.resumeSourcesBinding,
      parse: (args) => {
        requireArgs(args, 1, IPC_CHANNEL.resumeSourcesBinding)
        parsePayload(resumeIdSchema, args[0], 'projectId')
        return args
      },
      invoke: (args) => services.resumeSources.binding(args[0] as string),
    },
    {
      channel: IPC_CHANNEL.resumeSourcesDiscover,
      parse: (args) => {
        requireArgs(args, 2, IPC_CHANNEL.resumeSourcesDiscover)
        parsePayload(resumeIdSchema, args[0], 'projectId')
        parsePayload(resumeIdSchema, args[1], 'requestId')
        return args
      },
      invoke: (args) => services.resumeSources.discover(args[0] as string, args[1] as string),
    },
    {
      channel: IPC_CHANNEL.resumeSourcesPrepare,
      parse: (args) => {
        requireArgs(args, 3, IPC_CHANNEL.resumeSourcesPrepare)
        parsePayload(resumeIdSchema, args[0], 'projectId')
        parsePayload(resumeTokenSchema, args[1], 'token')
        parsePayload(resumeIdSchema, args[2], 'requestId')
        return args
      },
      invoke: (args) =>
        services.resumeSources.prepare(args[0] as string, args[1] as string, args[2] as string),
    },
    serviceChannel(IPC_CHANNEL.resumeSourcesImportLegacy, [], () =>
      services.resumeSources.importLegacy(),
    ),
    // Kanban adapter channels (spec kanban-adapter-interface Data/API).
    // adaptersList/getConfig/setConfig are synchronous app-side operations;
    // test/listBoard/create/update invoke adapter processes (async).
    serviceChannel(IPC_CHANNEL.kanbanAdaptersList, [], () => services.kanban.adaptersList()),
    serviceChannel(IPC_CHANNEL.kanbanGetConfig, ['string'], (args) =>
      services.kanban.getConfig(args[0]),
    ),
    {
      channel: IPC_CHANNEL.kanbanSetConfig,
      parse: (payload) => {
        requireArgs(payload, 2, IPC_CHANNEL.kanbanSetConfig)
        assertString(payload[0], `${IPC_CHANNEL.kanbanSetConfig} arg[0]`)
        parsePayload(
          kanbanSetConfigInputSchema,
          payload[1],
          `${IPC_CHANNEL.kanbanSetConfig} arg[1]`,
        )
        return payload
      },
      invoke: (args) =>
        services.kanban.setConfig(args[0] as string, args[1] as KanbanSetConfigInput),
    },
    {
      channel: IPC_CHANNEL.kanbanTest,
      parse: (payload) => {
        requireArgs(payload, 2, IPC_CHANNEL.kanbanTest)
        assertString(payload[0], `${IPC_CHANNEL.kanbanTest} arg[0]`)
        parsePayload(stringValuesSchema.optional(), payload[1], `${IPC_CHANNEL.kanbanTest} arg[1]`)
        return payload
      },
      invoke: (args) =>
        services.kanban.test(args[0] as string, args[1] as Record<string, string> | undefined),
    },
    serviceChannel(IPC_CHANNEL.kanbanListBoard, ['string'], (args) =>
      services.kanban.listBoard(args[0]),
    ),
    {
      channel: IPC_CHANNEL.kanbanCreateItem,
      parse: (payload) => {
        requireArgsWithOptional(payload, 2, IPC_CHANNEL.kanbanCreateItem)
        assertString(payload[0], `${IPC_CHANNEL.kanbanCreateItem} arg[0]`)
        parsePayload(kanbanCreateInputSchema, payload[1], `${IPC_CHANNEL.kanbanCreateItem} arg[1]`)
        assertOptionalRevision(payload[2], `${IPC_CHANNEL.kanbanCreateItem} arg[2]`)
        return payload
      },
      invoke: (args) =>
        args.length === 3
          ? services.kanban.createItem(
              args[0] as string,
              args[1] as KanbanCreateInput,
              args[2] as number | undefined,
            )
          : services.kanban.createItem(args[0] as string, args[1] as KanbanCreateInput),
    },
    {
      channel: IPC_CHANNEL.kanbanUpdateItem,
      parse: (payload) => {
        requireArgsWithOptional(payload, 3, IPC_CHANNEL.kanbanUpdateItem)
        assertString(payload[0], `${IPC_CHANNEL.kanbanUpdateItem} arg[0]`)
        assertString(payload[1], `${IPC_CHANNEL.kanbanUpdateItem} arg[1]`)
        parsePayload(kanbanUpdatePatchSchema, payload[2], `${IPC_CHANNEL.kanbanUpdateItem} arg[2]`)
        assertOptionalRevision(payload[3], `${IPC_CHANNEL.kanbanUpdateItem} arg[3]`)
        return payload
      },
      invoke: (args) =>
        args.length === 4
          ? services.kanban.updateItem(
              args[0] as string,
              args[1] as string,
              args[2] as KanbanUpdatePatch,
              args[3] as number | undefined,
            )
          : services.kanban.updateItem(
              args[0] as string,
              args[1] as string,
              args[2] as KanbanUpdatePatch,
            ),
    },
    {
      channel: IPC_CHANNEL.kanbanGetItem,
      parse: (payload) => {
        requireArgs(payload, 2, IPC_CHANNEL.kanbanGetItem)
        assertString(payload[0], `${IPC_CHANNEL.kanbanGetItem} arg[0]`)
        assertString(payload[1], `${IPC_CHANNEL.kanbanGetItem} arg[1]`)
        if ((payload[0] as string).length === 0 || (payload[1] as string).length === 0) {
          fail(IPC_CHANNEL.kanbanGetItem, 'requires non-empty projectId and ref')
        }
        return payload
      },
      invoke: (args) => services.kanban.getItem(args[0] as string, args[1] as string),
    },
    {
      channel: IPC_CHANNEL.kanbanGetComments,
      parse: (payload) => {
        requireArgs(payload, 2, IPC_CHANNEL.kanbanGetComments)
        assertString(payload[0], `${IPC_CHANNEL.kanbanGetComments} arg[0]`)
        assertString(payload[1], `${IPC_CHANNEL.kanbanGetComments} arg[1]`)
        if ((payload[0] as string).length === 0 || (payload[1] as string).length === 0) {
          fail(IPC_CHANNEL.kanbanGetComments, 'requires non-empty projectId and ref')
        }
        return payload
      },
      invoke: (args) => services.kanban.getComments(args[0] as string, args[1] as string),
    },
    // `Use a local task list` (project-home spec Behaviour 7): one registered
    // project id; main resolves the fixed path under the stored root.
    {
      channel: IPC_CHANNEL.kanbanBindLocalFile,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.kanbanBindLocalFile)
        assertString(payload[0], `${IPC_CHANNEL.kanbanBindLocalFile} arg[0]`)
        if ((payload[0] as string).length === 0) {
          fail(IPC_CHANNEL.kanbanBindLocalFile, 'requires a non-empty projectId')
        }
        return payload
      },
      invoke: (args) => services.kanban.bindLocalFile(args[0] as string),
    },
    // `Teach agents` (project-home spec Behaviour 11-12): one registered
    // project id each. The renderer sends no path and no skill text; main
    // builds both from the stored root and the bound source.
    {
      channel: IPC_CHANNEL.kanbanSkillStatus,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.kanbanSkillStatus)
        assertString(payload[0], `${IPC_CHANNEL.kanbanSkillStatus} arg[0]`)
        if ((payload[0] as string).length === 0) {
          fail(IPC_CHANNEL.kanbanSkillStatus, 'requires a non-empty projectId')
        }
        return payload
      },
      invoke: (args) => services.kanban.skillStatus(args[0] as string),
    },
    {
      channel: IPC_CHANNEL.kanbanWriteSkill,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.kanbanWriteSkill)
        assertString(payload[0], `${IPC_CHANNEL.kanbanWriteSkill} arg[0]`)
        if ((payload[0] as string).length === 0) {
          fail(IPC_CHANNEL.kanbanWriteSkill, 'requires a non-empty projectId')
        }
        return payload
      },
      invoke: (args) => services.kanban.writeSkill(args[0] as string),
    },
    {
      channel: IPC_CHANNEL.kanbanLaunchTask,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.kanbanLaunchTask)
        parsePayload(kanbanLaunchTaskInputSchema, payload[0], IPC_CHANNEL.kanbanLaunchTask)
        return payload
      },
      invoke: (args) => services.kanban.launchTask(args[0] as KanbanLaunchTaskInput),
    },
    // Task progress adapter channels (spec task-progress-adapters Data/API).
    // The renderer names only an adapter id; main resolves the command and
    // directory from the discovered manifest.
    serviceChannel(IPC_CHANNEL.taskProgressAdaptersList, [], () =>
      services.taskProgress.adaptersList(),
    ),
    serviceChannel(IPC_CHANNEL.taskProgressGetBinding, ['string'], (args) =>
      services.taskProgress.getBinding(args[0]),
    ),
    {
      channel: IPC_CHANNEL.taskProgressSaveBinding,
      parse: (payload) => {
        const channel = IPC_CHANNEL.taskProgressSaveBinding
        requireArgs(payload, 3, channel)
        assertString(payload[0], `${channel} arg[0]`)
        if (payload[1] !== null) {
          assertAdapterId(payload[1], `${channel} arg[1]`)
        }
        parsePayload(stringValuesSchema, payload[2], `${channel} arg[2]`)
        return payload
      },
      invoke: (args) =>
        services.taskProgress.saveBinding(
          args[0] as string,
          args[1] as string | null,
          args[2] as Record<string, string>,
        ),
    },
    {
      channel: IPC_CHANNEL.taskProgressTest,
      parse: (payload) => {
        const channel = IPC_CHANNEL.taskProgressTest
        requireArgs(payload, 3, channel)
        assertString(payload[0], `${channel} arg[0]`)
        assertAdapterId(payload[1], `${channel} arg[1]`)
        parsePayload(stringValuesSchema, payload[2], `${channel} arg[2]`)
        return payload
      },
      invoke: (args) =>
        services.taskProgress.test(
          args[0] as string,
          args[1] as string,
          args[2] as Record<string, string>,
        ),
    },
    {
      channel: IPC_CHANNEL.taskProgressObserve,
      parse: (payload) => {
        const channel = IPC_CHANNEL.taskProgressObserve
        requireArgs(payload, 1, channel)
        const ids = payload[0]
        if (!Array.isArray(ids) || ids.length > MAX_OBSERVED_PROJECTS) {
          fail(`${channel} arg[0]`, `must be an array of at most ${MAX_OBSERVED_PROJECTS} ids`)
        }
        ;(ids as unknown[]).forEach((id, index) => {
          assertString(id, `${channel} arg[0][${index}]`)
        })
        return payload
      },
      invoke: (args) => services.taskProgress.observe(args[0] as string[]),
    },
    serviceChannel(IPC_CHANNEL.taskProgressGet, ['string'], (args) =>
      services.taskProgress.get(args[0]),
    ),
    serviceChannel(IPC_CHANNEL.agentProfilesGet, ['string'], (args) =>
      services.agentProfiles.get(args[0]),
    ),
    serviceChannel(IPC_CHANNEL.agentProfilesLibraryGet, [], () =>
      services.agentProfiles.libraryGet(),
    ),
    serviceChannel(IPC_CHANNEL.agentProfilesTemplatesGet, [], () =>
      services.agentProfiles.templatesGet(),
    ),
    {
      channel: IPC_CHANNEL.agentProfilesSelectionGet,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.agentProfilesSelectionGet)
        parsePayload(agentIdSchema, payload[0], 'projectId')
        return payload
      },
      invoke: (args) => services.agentProfiles.selectionGet(args[0] as string),
    },
    {
      channel: IPC_CHANNEL.agentProfilesSelectionSet,
      parse: (payload) => {
        requireArgs(payload, 2, IPC_CHANNEL.agentProfilesSelectionSet)
        parsePayload(agentIdSchema, payload[0], 'projectId')
        parsePayload(agentProjectSelectionInputSchema, payload[1], 'selection')
        return payload
      },
      invoke: (args) =>
        services.agentProfiles.selectionSet(
          args[0] as string,
          args[1] as AgentProjectSelectionInput,
        ),
    },
    {
      channel: IPC_CHANNEL.agentProfilesPut,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.agentProfilesPut)
        parsePayload(agentProfilePutSchema, payload[0], `${IPC_CHANNEL.agentProfilesPut} arg[0]`)
        return payload
      },
      invoke: (args) => services.agentProfiles.put(args[0] as AgentProfilePut),
    },
    {
      channel: IPC_CHANNEL.agentProfilesDelete,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.agentProfilesDelete)
        parsePayload(agentIdSchema, payload[0], `${IPC_CHANNEL.agentProfilesDelete} arg[0]`)
        return payload
      },
      invoke: (args) => services.agentProfiles.delete(args[0] as string),
    },
    {
      channel: IPC_CHANNEL.dialogsPickDirectory,
      parse: (payload) => {
        requireArgs(payload, 1, IPC_CHANNEL.dialogsPickDirectory)
        if (payload[0] !== null) {
          assertSafePath(payload[0], `${IPC_CHANNEL.dialogsPickDirectory} defaultPath`)
        }
        return payload
      },
      invoke: (args) => services.dialogs.pickDirectory(args[0] as string | null),
    },
  ]
}
