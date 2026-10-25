import { useEffect, useState } from 'react'
import type {
  DictationPostProcessingLevel,
  DictationPostProcessingMode,
  DictationPostProcessingSettings,
  SttProviderSummary,
} from '../../../../shared/dictation-contract'
import type { AppApi } from '../../../../shared/ipc-contract'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { DesktopDictationSettings } from './DesktopDictationSettings'
import {
  FieldRow,
  GroupBox,
  GroupFooter,
  MaskedKeyControl,
  primaryClass,
  SectionLabel,
  SettingsGroup,
  SettingsSelect,
  SettingsSwitch,
  StackedRow,
  secondaryClass,
  textClass,
} from './settings-ui'

/** Select value of the OpenWhispr desktop shortcut method. It is not an STT
    adapter: choosing it turns desktop dictation on, choosing an adapter turns
    it off, so exactly one dictation method is active (AC-014). */
export const DESKTOP_SHORTCUT_METHOD = 'openwhispr-desktop-shortcut'

export interface DictationSettingsProps {
  api: AppApi['dictation']
  desktopDictation?: ReturnType<
    typeof import('../../hooks/useDesktopDictation').useDesktopDictation
  >
}

interface SecretMetadata {
  configured: boolean
  lastFour: string
  valid?: boolean
}

function isSecretMetadata(val: unknown): val is SecretMetadata {
  return typeof val === 'object' && val !== null && 'configured' in val
}

export function DictationSettings({ api, desktopDictation }: DictationSettingsProps) {
  const [providers, setProviders] = useState<SttProviderSummary[]>([])
  const [activeProviderId, setActiveProviderId] = useState<string>('')
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Secret editing state: map of fieldKey -> boolean (true if in input mode)
  const [editingSecrets, setEditingSecrets] = useState<Record<string, boolean>>({})
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({})

  // Connection testing state
  const [testingConnection, setTestingConnection] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Model discovery state
  const [discoveredModels, setDiscoveredModels] = useState<Array<{ id: string; name: string }>>([])
  const [discoveringModels, setDiscoveringModels] = useState(false)

  // Post-processing state
  const [postProcessing, setPostProcessing] = useState<DictationPostProcessingSettings | null>(null)
  const [ppMode, setPpMode] = useState<DictationPostProcessingMode>('disabled')
  const [ppLevel, setPpLevel] = useState<DictationPostProcessingLevel>('light')
  const [ppModel, setPpModel] = useState<string>('openai/gpt-4o-mini')
  const [editingPpKey, setEditingPpKey] = useState(false)
  const [ppKeyInput, setPpKeyInput] = useState<string>('')
  const [savingPp, setSavingPp] = useState(false)
  const [ppSaveStatus, setPpSaveStatus] = useState<string | null>(null)

  // Initial load: providers, active provider, post-processing settings
  useEffect(() => {
    let disposed = false
    setLoading(true)
    setError(null)

    Promise.all([
      api.providersList(),
      api.getActiveProvider(),
      api.postProcessingGetSettings().catch(() => null),
    ])
      .then(([providersList, activeId, ppSettings]) => {
        if (disposed) return
        setProviders(providersList)
        const chosenId = activeId || (providersList[0]?.id ?? '')
        setActiveProviderId(chosenId)
        if (ppSettings) {
          setPostProcessing(ppSettings)
          setPpMode(ppSettings.mode)
          setPpLevel(ppSettings.level)
          if (ppSettings.model) {
            setPpModel(ppSettings.model)
          }
        }
        if (chosenId) {
          return api.providersGetConfig(chosenId).then((loadedConfig) => {
            if (!disposed) {
              setConfig(loadedConfig ?? {})
            }
          })
        }
      })
      .catch((err) => {
        if (!disposed) {
          setError(err instanceof Error ? err.message : 'Failed to load dictation settings.')
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [api])

  const desktopSelectable = desktopDictation?.setup.supported === true
  const desktopSelected = desktopSelectable && desktopDictation?.setup.settings.enabled === true
  const activeProvider = desktopSelected
    ? undefined
    : providers.find((p) => p.id === activeProviderId)

  async function handleMethodChange(value: string) {
    if (value === DESKTOP_SHORTCUT_METHOD) {
      if (!desktopDictation) return
      await desktopDictation.configure({ enabled: true, confirmed: false })
      return
    }
    // Keep exactly one method: switch the adapter only once the shortcut is
    // off. A failed save stays on the shortcut and shows its error.
    if (desktopSelected && desktopDictation) {
      const disabled = await desktopDictation.configure({ enabled: false, confirmed: false })
      if (!disabled) return
    }
    await handleProviderChange(value)
  }

  // Switch provider handler
  async function handleProviderChange(newProviderId: string) {
    setActiveProviderId(newProviderId)
    setTestResult(null)
    setDiscoveredModels([])
    setEditingSecrets({})
    setSecretInputs({})
    setSaveStatus(null)

    try {
      await api.setActiveProvider(newProviderId)
      const loadedConfig = await api.providersGetConfig(newProviderId)
      setConfig(loadedConfig ?? {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch provider.')
    }
  }

  // Update field in config
  function handleFieldChange(key: string, value: unknown) {
    setConfig((prev) => ({ ...prev, [key]: value }))
    setSaveStatus(null)
  }

  // Secret controls
  function startEditingSecret(key: string) {
    setEditingSecrets((prev) => ({ ...prev, [key]: true }))
    setSecretInputs((prev) => ({ ...prev, [key]: '' }))
  }

  function cancelEditingSecret(key: string) {
    setEditingSecrets((prev) => ({ ...prev, [key]: false }))
    setSecretInputs((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function handleClearSecret(key: string) {
    setSaveStatus(null)
    setSaving(true)
    try {
      await api.providersSetConfig(activeProviderId, { ...config, [key]: '' })
      const reloaded = await api.providersGetConfig(activeProviderId)
      setConfig(reloaded ?? {})
      setEditingSecrets((prev) => ({ ...prev, [key]: false }))
      setSecretInputs((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      setSaveStatus('Secret cleared.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear secret.')
    } finally {
      setSaving(false)
    }
  }

  // Save current provider configuration
  async function handleSaveConfig() {
    if (!activeProviderId) return
    setSaving(true)
    setError(null)
    setSaveStatus(null)
    setTestResult(null)

    const payload: Record<string, unknown> = { ...config }
    for (const field of activeProvider?.configSchema ?? []) {
      if (field.type === 'secret') delete payload[field.key]
    }
    // Attach newly entered secrets
    for (const [key, val] of Object.entries(secretInputs)) {
      if (val.trim().length > 0) {
        payload[key] = val
      }
    }

    try {
      await api.providersSetConfig(activeProviderId, payload)
      // Clear plaintext secrets from state immediately
      setSecretInputs({})
      setEditingSecrets({})
      // Reload masked metadata
      const reloaded = await api.providersGetConfig(activeProviderId)
      setConfig(reloaded ?? {})
      setSaveStatus('Configuration saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration.')
    } finally {
      setSaving(false)
    }
  }

  // Test Connection
  async function handleTestConnection() {
    if (!activeProviderId) return
    setTestingConnection(true)
    setTestResult(null)
    setSaveStatus(null)

    const currentConfig: Record<string, unknown> = { ...config }
    for (const [key, val] of Object.entries(secretInputs)) {
      if (val.trim().length > 0) {
        currentConfig[key] = val
      }
    }

    try {
      const result = await api.providersTestConnection(activeProviderId, currentConfig)
      setTestResult(result)
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Connection test failed.',
      })
    } finally {
      setTestingConnection(false)
    }
  }

  // Model discovery
  async function handleDiscoverModels() {
    if (!activeProviderId) return
    setDiscoveringModels(true)
    try {
      const models = await api.providersDiscoverModels(activeProviderId, config)
      setDiscoveredModels(models)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discover models.')
    } finally {
      setDiscoveringModels(false)
    }
  }

  // Save post-processing settings
  async function handleSavePostProcessing() {
    setSavingPp(true)
    setPpSaveStatus(null)
    try {
      await api.postProcessingSetSettings({
        mode: ppMode,
        level: ppLevel,
        model: ppModel,
        apiKey: ppKeyInput.trim().length > 0 ? ppKeyInput : undefined,
      })
      setPpKeyInput('')
      setEditingPpKey(false)
      const updated = await api.postProcessingGetSettings()
      setPostProcessing(updated)
      setPpSaveStatus('Post-processing settings saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save post-processing settings.')
    } finally {
      setSavingPp(false)
    }
  }

  async function handleClearPpKey() {
    setSavingPp(true)
    try {
      await api.postProcessingSetSettings({
        mode: ppMode,
        level: ppLevel,
        model: ppModel,
        apiKey: '',
      })
      setPpKeyInput('')
      setEditingPpKey(false)
      const updated = await api.postProcessingGetSettings()
      setPostProcessing(updated)
      setPpSaveStatus('API key cleared.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear API key.')
    } finally {
      setSavingPp(false)
    }
  }

  const connectionFailed = testResult !== null && !testResult.ok
  const connectionStatus = testResult ? (
    <span
      data-testid="dictation-test-feedback"
      role={testResult.ok ? 'status' : 'alert'}
      className={testResult.ok ? 'text-success' : 'text-error'}
    >
      {testResult.ok ? (
        <span data-testid="dictation-test-success">
          {testResult.message || 'Connected successfully'}
        </span>
      ) : (
        <span data-testid="dictation-test-error">{testResult.message || 'Connection failed'}</span>
      )}
    </span>
  ) : saveStatus ? (
    <span data-testid="dictation-save-status" role="status" className="text-success">
      {saveStatus}
    </span>
  ) : null

  if (loading) {
    return (
      <div data-testid="dictation-settings-loading" className="text-sm text-ink-secondary">
        Loading dictation providers...
      </div>
    )
  }

  return (
    <div
      data-testid="dictation-settings"
      className="flex flex-col gap-7 text-sm text-ink-secondary"
    >
      {error ? (
        <div
          role="alert"
          className="rounded-[8px] border border-error/40 bg-error/10 p-2 text-xs text-error"
        >
          {error}
        </div>
      ) : null}

      <SettingsGroup label="Provider">
        <SectionLabel title="Provider" />
        <GroupBox>
          <FieldRow label="Speech-to-text provider" htmlFor="dictation-provider-select">
            <SettingsSelect
              id="dictation-provider-select"
              testId="dictation-provider-select"
              value={desktopSelected ? DESKTOP_SHORTCUT_METHOD : activeProviderId}
              disabled={desktopDictation?.saving === true}
              onChange={(value) => void handleMethodChange(value)}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {desktopSelectable ? (
                <option value={DESKTOP_SHORTCUT_METHOD}>
                  OpenWhispr desktop shortcut (Ctrl + Super)
                </option>
              ) : null}
            </SettingsSelect>
          </FieldRow>
          {activeProvider?.description ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-edge px-4 py-2.5 text-xs text-ink-muted">
              <span className="inline-flex items-center gap-1.5 text-ink-secondary">
                <Icon.info size={13} aria-hidden />
                Beta limits
              </span>
              <span>{activeProvider.description}</span>
            </div>
          ) : null}
        </GroupBox>
        {desktopDictation?.control.error ? (
          <p role="alert" data-testid="dictation-method-error" className="text-xs text-error">
            {desktopDictation.control.error}
          </p>
        ) : null}
      </SettingsGroup>

      {activeProvider && activeProvider.configSchema.length > 0 ? (
        <SettingsGroup label="Connection">
          <SectionLabel title="Connection" />
          <h4 className="sr-only">Provider Configuration ({activeProvider.name})</h4>
          <GroupBox>
            {activeProvider.configSchema.map((field, index) => {
              const val = config[field.key]
              const isSecret = field.type === 'secret'
              const secretMeta = isSecret && isSecretMetadata(val) ? val : null
              const isConfiguredSecret = Boolean(secretMeta?.configured)
              const isEditing = Boolean(editingSecrets[field.key])
              const fieldId = `config-field-${field.key}`
              const divided = index > 0

              if (field.type === 'boolean') {
                const checked = Boolean(val ?? field.defaultValue ?? false)
                return (
                  <div key={field.key}>
                    <SettingsSwitch
                      id={`dictation-label-${field.key}`}
                      label={field.label}
                      description={field.description}
                      checked={checked}
                      divided={divided}
                      testId={`dictation-config-${field.key}`}
                      onChange={(next) => handleFieldChange(field.key, next)}
                    />
                    {((field.key === 'enableNativeEdit' && val) ?? field.defaultValue) ? (
                      <div
                        role="note"
                        data-testid="elevenlabs-surcharge-warning"
                        className="border-t border-edge px-4 py-3 text-xs text-warning"
                      >
                        Notice: Enabling native transcript editing adds an explicit +30% API cost
                        surcharge to ElevenLabs usage.
                      </div>
                    ) : null}
                  </div>
                )
              }

              if (field.type === 'select') {
                return (
                  <FieldRow
                    key={field.key}
                    label={field.label}
                    htmlFor={fieldId}
                    description={field.description}
                    divided={divided}
                  >
                    <SettingsSelect
                      id={fieldId}
                      testId={`dictation-config-${field.key}`}
                      value={(val as string) ?? (field.defaultValue as string) ?? ''}
                      onChange={(value) => handleFieldChange(field.key, value)}
                    >
                      {field.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </SettingsSelect>
                  </FieldRow>
                )
              }

              if (field.type === 'number') {
                return (
                  <FieldRow
                    key={field.key}
                    label={field.label}
                    htmlFor={fieldId}
                    description={field.description}
                    divided={divided}
                  >
                    <input
                      id={fieldId}
                      type="number"
                      data-testid={`dictation-config-${field.key}`}
                      value={
                        val !== undefined
                          ? String(val)
                          : field.defaultValue !== undefined
                            ? String(field.defaultValue)
                            : ''
                      }
                      placeholder={field.placeholder}
                      onChange={(e) => handleFieldChange(field.key, Number(e.target.value))}
                      className={textClass}
                    />
                  </FieldRow>
                )
              }

              if (isSecret) {
                const showInput = !isConfiguredSecret || isEditing
                return (
                  <div
                    key={field.key}
                    className={cn(
                      'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 px-4 py-3',
                      divided && 'border-t border-edge',
                    )}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {showInput ? (
                        <label htmlFor={fieldId} className="text-[13px] font-medium text-ink">
                          {field.label}
                        </label>
                      ) : (
                        <span className="text-[13px] font-medium text-ink">{field.label}</span>
                      )}
                      {field.description ? (
                        <span className="text-xs text-ink-muted">{field.description}</span>
                      ) : null}
                    </div>
                    <MaskedKeyControl
                      masked={showInput ? null : `••••••••${secretMeta?.lastFour ?? ''}`}
                      value={secretInputs[field.key] ?? ''}
                      inputId={fieldId}
                      placeholder={field.placeholder || 'Enter secret key'}
                      invalid={connectionFailed}
                      onValueChange={(next) =>
                        setSecretInputs((prev) => ({ ...prev, [field.key]: next }))
                      }
                      onEdit={() => startEditingSecret(field.key)}
                      onClear={() => handleClearSecret(field.key)}
                      onCancel={isEditing ? () => cancelEditingSecret(field.key) : undefined}
                      previewTestId={`secret-preview-${field.key}`}
                      inputTestId={`secret-input-${field.key}`}
                      editTestId={`secret-update-${field.key}`}
                      clearTestId={`secret-clear-${field.key}`}
                      cancelTestId={`secret-cancel-${field.key}`}
                    />
                  </div>
                )
              }

              return (
                <FieldRow
                  key={field.key}
                  label={field.label}
                  htmlFor={fieldId}
                  description={field.description}
                  divided={divided}
                >
                  <div className="flex flex-col gap-2">
                    {field.key === 'model' && activeProvider.capabilities.modelDiscovery ? (
                      <div className="flex items-center gap-2">
                        <input
                          id={fieldId}
                          type="text"
                          data-testid={`dictation-config-${field.key}`}
                          value={(val as string) ?? (field.defaultValue as string) ?? ''}
                          placeholder={field.placeholder}
                          onChange={(e) => handleFieldChange(field.key, e.target.value)}
                          className={textClass}
                        />
                        <button
                          type="button"
                          data-testid="dictation-refresh-models"
                          disabled={discoveringModels}
                          onClick={handleDiscoverModels}
                          className={secondaryClass}
                        >
                          {discoveringModels ? 'Discovering...' : 'Discover Models'}
                        </button>
                      </div>
                    ) : (
                      <input
                        id={fieldId}
                        type={field.type === 'url' ? 'url' : 'text'}
                        data-testid={`dictation-config-${field.key}`}
                        value={(val as string) ?? (field.defaultValue as string) ?? ''}
                        placeholder={field.placeholder}
                        onChange={(e) => handleFieldChange(field.key, e.target.value)}
                        className={textClass}
                      />
                    )}
                    {field.key === 'model' && discoveredModels.length > 0 ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-ink-muted">Discovered:</span>
                        <SettingsSelect
                          id={`dictation-discovered-${field.key}`}
                          testId="dictation-discovered-models-select"
                          value={(val as string) ?? ''}
                          onChange={(value) => handleFieldChange('model', value)}
                        >
                          <option value="">Select a discovered model...</option>
                          {discoveredModels.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name || m.id}
                            </option>
                          ))}
                        </SettingsSelect>
                      </div>
                    ) : null}
                  </div>
                </FieldRow>
              )
            })}
            <GroupFooter status={connectionStatus}>
              <button
                type="button"
                data-testid="dictation-test-connection"
                disabled={testingConnection || saving}
                onClick={() => void handleTestConnection()}
                className={secondaryClass}
              >
                {testingConnection ? 'Testing...' : 'Test connection'}
              </button>
              <button
                type="button"
                data-testid="dictation-save-config"
                disabled={saving}
                onClick={() => void handleSaveConfig()}
                className={primaryClass}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </GroupFooter>
          </GroupBox>
        </SettingsGroup>
      ) : null}

      {desktopSelected ? null : (
        <SettingsGroup label="Post-processing">
          <SectionLabel title="Post-processing" />
          <GroupBox>
            <FieldRow
              label="Mode"
              htmlFor="dictation-post-processing-mode"
              description="Format, punctuate, and clean up transcripts with deterministic safety guardrails."
            >
              <SettingsSelect
                id="dictation-post-processing-mode"
                testId="dictation-post-processing-mode"
                value={ppMode}
                onChange={(value) => setPpMode(value as DictationPostProcessingMode)}
              >
                <option value="disabled">Disabled</option>
                <option value="provider_native">Provider Native (ElevenLabs Scribe v2)</option>
                <option value="external_llm">External LLM (OpenRouter)</option>
              </SettingsSelect>
            </FieldRow>
            <div className={ppMode === 'disabled' ? 'opacity-50' : undefined}>
              <FieldRow
                label="Correction level"
                htmlFor="dictation-post-processing-level"
                description={
                  ppMode === 'disabled'
                    ? 'Turn post-processing on to choose a level.'
                    : 'How much the transcript may be changed.'
                }
                divided
              >
                <SettingsSelect
                  id="dictation-post-processing-level"
                  testId="dictation-post-processing-level"
                  value={ppLevel}
                  disabled={ppMode === 'disabled'}
                  onChange={(value) => setPpLevel(value as DictationPostProcessingLevel)}
                >
                  <option value="light">Light (Punctuation & Glossary)</option>
                  <option value="medium">Medium (Light + Remove Filler Words & Grammar)</option>
                  <option value="full">Full (Clarity & Phrasing While Preserving Details)</option>
                </SettingsSelect>
              </FieldRow>
            </div>
            {ppMode === 'external_llm' ? (
              <div className="flex flex-col border-t border-edge">
                <StackedRow label="LLM Model Identifier" htmlFor="dictation-post-processing-model">
                  <input
                    id="dictation-post-processing-model"
                    type="text"
                    data-testid="dictation-post-processing-model"
                    value={ppModel}
                    onChange={(e) => setPpModel(e.target.value)}
                    placeholder="openai/gpt-4o-mini"
                    className={textClass}
                  />
                </StackedRow>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 border-t border-edge px-4 py-3">
                  <span className="text-[13px] font-medium text-ink">OpenRouter API Key</span>
                  <MaskedKeyControl
                    masked={postProcessing?.hasApiKey && !editingPpKey ? '••••••••••••' : null}
                    value={ppKeyInput}
                    inputId="dictation-pp-secret-input"
                    placeholder="sk-or-v1-..."
                    onValueChange={setPpKeyInput}
                    onEdit={() => setEditingPpKey(true)}
                    onClear={() => void handleClearPpKey()}
                    onCancel={
                      editingPpKey
                        ? () => {
                            setEditingPpKey(false)
                            setPpKeyInput('')
                          }
                        : undefined
                    }
                    previewTestId="pp-secret-preview"
                    inputTestId="pp-secret-input"
                    editTestId="pp-secret-update"
                    clearTestId="pp-secret-clear"
                    cancelTestId="pp-secret-cancel"
                  />
                </div>
              </div>
            ) : null}
            <GroupFooter
              status={
                ppSaveStatus ? (
                  <span
                    data-testid="dictation-pp-save-status"
                    role="status"
                    className="text-success"
                  >
                    {ppSaveStatus}
                  </span>
                ) : (
                  <span>Applies to new transcriptions.</span>
                )
              }
            >
              <button
                type="button"
                data-testid="dictation-post-processing-save"
                disabled={savingPp}
                onClick={() => void handleSavePostProcessing()}
                className={primaryClass}
              >
                {savingPp ? 'Saving...' : 'Save'}
              </button>
            </GroupFooter>
          </GroupBox>
        </SettingsGroup>
      )}

      {desktopSelected && desktopDictation ? (
        <SettingsGroup label="OpenWhispr Desktop Shortcut (V1 Mode)">
          <h4 className="text-[13px] font-medium text-ink">
            OpenWhispr Desktop Shortcut (V1 Mode)
          </h4>
          <GroupBox>
            <div className="px-4 py-3">
              <DesktopDictationSettings
                setup={desktopDictation.setup}
                saving={desktopDictation.saving || desktopDictation.control.busy}
                onChange={desktopDictation.configure}
              />
            </div>
          </GroupBox>
        </SettingsGroup>
      ) : null}
    </div>
  )
}
