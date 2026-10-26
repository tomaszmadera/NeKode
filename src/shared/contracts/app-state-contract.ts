// Keys of the flat app_state key–value store (spec Data/API). Shared so the
// renderer persists with the same keys the main process cleans up.
export const APP_STATE_KEY = {
  dictationEnabled: 'dictation.enabled',
  dictationDesktop: 'dictation.desktop',
  dictationLanguage: 'dictation.language',
  dictationModel: 'dictation.model',
  dictationTimeoutSeconds: 'dictation.timeoutSeconds',
  dictationActiveProvider: 'dictation.activeProvider',
  dictationPostProcessingMode: 'dictation.postProcessing.mode',
  dictationPostProcessingLevel: 'dictation.postProcessing.level',
  dictationPostProcessingModel: 'dictation.postProcessing.model',
  dictationPostProcessingApiKey: 'dictation.postProcessing.apiKey',
  /** JSON containing state and checkedAt only. Historical, not startup readiness. */
  dictationStatus: 'dictation.status',
  selectedProjectId: 'selection.projectId',
  selectedChatId: 'selection.chatId',
  leftRegionWidth: 'region.left.width',
  bottomRegionHeight: 'region.bottom.height',
  /** '1' open, '0' hidden. Missing or any other value means hidden. */
  bottomRegionOpen: 'region.bottom.open',
  /** Last confirmed Add Project dialog directory: the next dialog's defaultPath. */
  projectsLastDirectory: 'projects.lastDirectory',
  /** '1' sends Handoff/Resume commands straight to the PTY; missing means paste-only. */
  autoSendHandoffResume: 'handoffResume.autoSend',
  /** '0' disables the Ctrl+Tab chat switch; missing or '1' means enabled. */
  chatSwitchEnabled: 'chatSwitch.enabled',
  /** '0' keeps original project names in the tree; missing or '1' means uppercase. */
  projectNamesUppercase: 'projects.namesUppercase',
  /** '0' hides project avatar icons in the tree; missing or '1' means shown. */
  showProjectIcons: 'projects.showIcons',
  /** '0' hides attention badges on unselected chat rows; missing or '1' means shown. */
  attentionBadgeEnabled: 'attention.badgeEnabled',
  /** '0' silences the attention chime for unselected chats; missing or '1' means on. */
  attentionChimeEnabled: 'attention.chimeEnabled',
  /** '0' silences the attention chime for the selected chat; missing or '1' means on. */
  attentionActiveChimeEnabled: 'attention.activeChimeEnabled',
  /** '0' hides the attention indicator on the selected chat's row; missing or '1' means shown. */
  attentionActiveIndicatorEnabled: 'attention.activeIndicatorEnabled',
  /**
   * JSON array of absolute executable paths the user added as custom shells
   * (spec project-shell-selection). App-level, shared across projects;
   * re-validated (dead paths pruned) on every shell detection run.
   */
  customShells: 'shells.custom',
} as const

/**
 * Per-project handoff directory setting key (spec handoff-resume-flow
 * Business rules). Empty or missing value means unconfigured; relative
 * values resolve against the project root at listing time.
 */
export function projectHandoffDirKey(projectId: string): string {
  return `project.handoffDir:${projectId}`
}

/** Per-project Kanban adapter binding key (spec kanban-adapter-interface Business rules). */
export function projectKanbanAdapterKey(projectId: string): string {
  return `project.kanbanAdapter:${projectId}`
}

/** Per-project Kanban adapter config JSON key (field values, secrets included). */
export function projectKanbanConfigKey(projectId: string): string {
  return `project.kanbanConfig:${projectId}`
}

/** Per-project task progress adapter id (spec task-progress-adapters Data/API). */
export function projectTaskProgressAdapterKey(projectId: string): string {
  return `project.taskProgressAdapter:${projectId}`
}

/** Per-project task progress adapter field values (JSON object of strings). */
export function projectTaskProgressConfigKey(projectId: string): string {
  return `project.taskProgressConfig:${projectId}`
}

/**
 * Task progress binding keys are written only through the validated
 * taskProgress:* channels (spec Authorization), never via generic state IPC.
 */
export function isTaskProgressStateKey(key: string): boolean {
  return (
    key.startsWith('project.taskProgressAdapter:') || key.startsWith('project.taskProgressConfig:')
  )
}

/** Keys that carry secret values and must never be accessed via generic state IPC. */
export function isSecretStateKey(key: string): boolean {
  return (
    key.startsWith('usage.') ||
    key === 'project.kanbanConfig' ||
    key.startsWith('project.kanbanConfig:') ||
    key.startsWith('dictation.providerConfig:') ||
    key === APP_STATE_KEY.dictationPostProcessingApiKey
  )
}

/**
 * Per-project shell choice key (spec project-shell-selection). The stored
 * value is a `ShellChoice` id; empty or missing means `default` (the
 * platform default shell, unchanged behavior).
 */
export function projectShellKey(projectId: string): string {
  return `project.shell:${projectId}`
}

export function dictationProviderConfigKey(providerId: string): string {
  return `dictation.providerConfig:${providerId}`
}

/**
 * Per-project color key (hex string from PROJECT_COLOR_PALETTE or custom).
 * Missing or empty value means automatic (deterministic hash).
 */
export function projectColorKey(projectId: string): string {
  return `project.color:${projectId}`
}

/** Custom Linux shells belong to one project and its persisted distribution. */
export function projectWslShellsKey(projectId: string): string {
  return `project.wslShells:${projectId}`
}
