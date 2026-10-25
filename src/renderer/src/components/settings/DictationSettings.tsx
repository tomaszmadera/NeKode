import { useEffect, useState } from 'react'
import type {
  DictationPostProcessingLevel,
  DictationPostProcessingMode,
  DictationPostProcessingSettings,
  SttProviderSummary,
} from '../../../../shared/dictation-contract'
import type { AppApi } from '../../../../shared/ipc-contract'
import { DesktopDictationSettings } from './DesktopDictationSettings'

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

    const payload: Record<string, unknown> = { ...config }
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

  if (loading) {
    return (
      <div data-testid="dictation-settings-loading" className="text-sm text-ink-secondary">
        Loading dictation providers...
      </div>
    )
  }

  return (
    <div data-testid="dictation-settings" className="space-y-6 text-sm text-ink-secondary">
      {error ? (
        <div
          role="alert"
          className="rounded border border-error/40 bg-error/10 p-2 text-xs text-error"
        >
          {error}
        </div>
      ) : null}

      {/* Provider Selection */}
      <section className="space-y-2">
        <label htmlFor="dictation-provider-select" className="block font-semibold text-ink">
          Speech-to-Text Provider
        </label>
        <div className="flex items-center gap-3">
          <select
            id="dictation-provider-select"
            data-testid="dictation-provider-select"
            value={desktopSelected ? DESKTOP_SHORTCUT_METHOD : activeProviderId}
            disabled={desktopDictation?.saving === true}
            onChange={(e) => void handleMethodChange(e.target.value)}
            className="rounded border border-edge bg-highlight px-3 py-1.5 text-sm text-ink"
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
          </select>
          {activeProvider?.description ? (
            <span className="text-xs text-ink-muted">{activeProvider.description}</span>
          ) : null}
        </div>
        {desktopDictation?.control.error ? (
          <p role="alert" data-testid="dictation-method-error" className="text-xs text-error">
            {desktopDictation.control.error}
          </p>
        ) : null}
      </section>

      {/* Schema-Driven Dynamic Configuration Form */}
      {activeProvider && activeProvider.configSchema.length > 0 ? (
        <section className="space-y-4 rounded-md border border-edge p-4">
          <h4 className="font-semibold text-ink">Provider Configuration ({activeProvider.name})</h4>

          <div className="space-y-3">
            {activeProvider.configSchema.map((field) => {
              const val = config[field.key]
              const isSecret = field.type === 'secret'
              const secretMeta = isSecret && isSecretMetadata(val) ? val : null
              const isConfiguredSecret = Boolean(secretMeta?.configured)
              const isEditing = Boolean(editingSecrets[field.key])

              return (
                <div key={field.key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor={`config-field-${field.key}`}
                      className="text-xs font-medium text-ink"
                    >
                      {field.label}
                      {field.required ? <span className="ml-0.5 text-error">*</span> : null}
                    </label>
                    {field.description ? (
                      <span className="text-xs text-ink-muted">{field.description}</span>
                    ) : null}
                  </div>

                  {/* Render based on field type */}
                  {field.type === 'boolean' ? (
                    <div className="space-y-1">
                      <label className="flex items-center gap-2">
                        <input
                          id={`config-field-${field.key}`}
                          type="checkbox"
                          data-testid={`dictation-config-${field.key}`}
                          checked={Boolean(val ?? field.defaultValue ?? false)}
                          onChange={(e) => handleFieldChange(field.key, e.target.checked)}
                          className="rounded border-edge"
                        />
                        <span className="text-xs text-ink-secondary">{field.label}</span>
                      </label>
                      {/* ElevenLabs native editing +30% surcharge disclosure (AC-003) */}
                      {((field.key === 'enableNativeEdit' && val) ?? field.defaultValue) ? (
                        <div
                          role="note"
                          data-testid="elevenlabs-surcharge-warning"
                          className="rounded border border-warning/30 bg-warning/10 p-2 text-xs text-warning"
                        >
                          Notice: Enabling native transcript editing adds an explicit +30% API cost
                          surcharge to ElevenLabs usage.
                        </div>
                      ) : null}
                    </div>
                  ) : field.type === 'select' ? (
                    <select
                      id={`config-field-${field.key}`}
                      data-testid={`dictation-config-${field.key}`}
                      value={(val as string) ?? (field.defaultValue as string) ?? ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      className="w-full rounded border border-edge bg-highlight px-3 py-1 text-xs text-ink"
                    >
                      {field.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'number' ? (
                    <input
                      id={`config-field-${field.key}`}
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
                      className="w-full rounded border border-edge bg-highlight px-3 py-1 text-xs text-ink"
                    />
                  ) : isSecret ? (
                    <div className="flex items-center gap-2">
                      {isConfiguredSecret && !isEditing ? (
                        <>
                          <span
                            data-testid={`secret-preview-${field.key}`}
                            className="font-mono text-xs text-ink"
                          >
                            ••••••••{secretMeta?.lastFour}
                          </span>
                          <button
                            type="button"
                            data-testid={`secret-update-${field.key}`}
                            onClick={() => startEditingSecret(field.key)}
                            className="rounded border border-edge px-2 py-0.5 text-xs hover:bg-highlight"
                          >
                            Change
                          </button>
                          <button
                            type="button"
                            data-testid={`secret-clear-${field.key}`}
                            onClick={() => handleClearSecret(field.key)}
                            className="rounded border border-edge px-2 py-0.5 text-xs text-error hover:bg-highlight"
                          >
                            Clear
                          </button>
                        </>
                      ) : (
                        <>
                          <input
                            id={`config-field-${field.key}`}
                            type="password"
                            data-testid={`secret-input-${field.key}`}
                            value={secretInputs[field.key] ?? ''}
                            placeholder={field.placeholder || 'Enter secret key'}
                            onChange={(e) =>
                              setSecretInputs((prev) => ({ ...prev, [field.key]: e.target.value }))
                            }
                            className="flex-1 rounded border border-edge bg-highlight px-3 py-1 text-xs text-ink"
                          />
                          {isEditing ? (
                            <button
                              type="button"
                              data-testid={`secret-cancel-${field.key}`}
                              onClick={() => cancelEditingSecret(field.key)}
                              className="rounded border border-edge px-2 py-0.5 text-xs hover:bg-highlight"
                            >
                              Cancel
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : (
                    // text or url
                    <div className="space-y-1">
                      {/* Model discovery dropdown if this is the model field and discovery is supported */}
                      {field.key === 'model' && activeProvider.capabilities.modelDiscovery ? (
                        <div className="flex items-center gap-2">
                          <input
                            id={`config-field-${field.key}`}
                            type="text"
                            data-testid={`dictation-config-${field.key}`}
                            value={(val as string) ?? (field.defaultValue as string) ?? ''}
                            placeholder={field.placeholder}
                            onChange={(e) => handleFieldChange(field.key, e.target.value)}
                            className="flex-1 rounded border border-edge bg-highlight px-3 py-1 text-xs text-ink"
                          />
                          <button
                            type="button"
                            data-testid="dictation-refresh-models"
                            disabled={discoveringModels}
                            onClick={handleDiscoverModels}
                            className="rounded border border-edge px-2 py-1 text-xs hover:bg-highlight disabled:opacity-50"
                          >
                            {discoveringModels ? 'Discovering...' : 'Discover Models'}
                          </button>
                        </div>
                      ) : (
                        <input
                          id={`config-field-${field.key}`}
                          type={field.type === 'url' ? 'url' : 'text'}
                          data-testid={`dictation-config-${field.key}`}
                          value={(val as string) ?? (field.defaultValue as string) ?? ''}
                          placeholder={field.placeholder}
                          onChange={(e) => handleFieldChange(field.key, e.target.value)}
                          className="w-full rounded border border-edge bg-highlight px-3 py-1 text-xs text-ink"
                        />
                      )}

                      {/* Discovered models dropdown */}
                      {field.key === 'model' && discoveredModels.length > 0 ? (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xs text-ink-muted">Discovered:</span>
                          <select
                            data-testid="dictation-discovered-models-select"
                            value={(val as string) ?? ''}
                            onChange={(e) => handleFieldChange('model', e.target.value)}
                            className="flex-1 rounded border border-edge bg-highlight px-2 py-1 text-xs text-ink"
                          >
                            <option value="">Select a discovered model...</option>
                            {discoveredModels.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name || m.id}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Form Actions: Save & Test Connection */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              data-testid="dictation-save-config"
              disabled={saving}
              onClick={handleSaveConfig}
              className="rounded bg-button px-3 py-1 text-xs font-medium text-ink hover:bg-button-hover disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>

            {/* Non-consuming Test Connection (AC-005) */}
            <button
              type="button"
              data-testid="dictation-test-connection"
              disabled={testingConnection || saving}
              onClick={handleTestConnection}
              className="rounded border border-edge px-3 py-1 text-xs hover:bg-highlight disabled:opacity-50"
            >
              {testingConnection ? 'Testing...' : 'Test Connection'}
            </button>

            {saveStatus ? (
              <span data-testid="dictation-save-status" className="text-xs text-success">
                {saveStatus}
              </span>
            ) : null}

            {testResult ? (
              <div
                data-testid="dictation-test-feedback"
                role={testResult.ok ? 'status' : 'alert'}
                className={`text-xs ${testResult.ok ? 'text-success' : 'text-error'}`}
              >
                {testResult.ok ? (
                  <span data-testid="dictation-test-success">
                    ✓ {testResult.message || 'Connected successfully'}
                  </span>
                ) : (
                  <span data-testid="dictation-test-error">
                    ✕ {testResult.message || 'Connection failed'}
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Post-Processing Pipeline Settings (in-app STT takes only) */}
      {desktopSelected ? null : (
        <section className="space-y-4 rounded-md border border-edge p-4">
          <div>
            <h4 className="font-semibold text-ink">Post-Processing Pipeline</h4>
            <p className="text-xs text-ink-muted">
              Format, punctuate, and clean up transcripts with deterministic safety guardrails.
            </p>
          </div>

          <div className="space-y-3">
            {/* Mode Select */}
            <div className="space-y-1">
              <label
                htmlFor="dictation-post-processing-mode"
                className="text-xs font-medium text-ink"
              >
                Post-Processing Mode
              </label>
              <select
                id="dictation-post-processing-mode"
                data-testid="dictation-post-processing-mode"
                value={ppMode}
                onChange={(e) => setPpMode(e.target.value as DictationPostProcessingMode)}
                className="w-full rounded border border-edge bg-highlight px-3 py-1 text-xs text-ink"
              >
                <option value="disabled">Disabled</option>
                <option value="provider_native">Provider Native (ElevenLabs Scribe v2)</option>
                <option value="external_llm">External LLM (OpenRouter)</option>
              </select>
            </div>

            {/* Level Select */}
            <div className="space-y-1">
              <label
                htmlFor="dictation-post-processing-level"
                className="text-xs font-medium text-ink"
              >
                Correction Level
              </label>
              <select
                id="dictation-post-processing-level"
                data-testid="dictation-post-processing-level"
                value={ppLevel}
                onChange={(e) => setPpLevel(e.target.value as DictationPostProcessingLevel)}
                className="w-full rounded border border-edge bg-highlight px-3 py-1 text-xs text-ink"
              >
                <option value="light">Light (Punctuation & Glossary)</option>
                <option value="medium">Medium (Light + Remove Filler Words & Grammar)</option>
                <option value="full">Full (Clarity & Phrasing While Preserving Details)</option>
              </select>
            </div>

            {/* When external_llm: model input/dropdown and secret input for OpenRouter API key */}
            {ppMode === 'external_llm' ? (
              <div className="space-y-3 rounded border border-edge/60 bg-highlight/30 p-3">
                <div className="space-y-1">
                  <label
                    htmlFor="dictation-post-processing-model"
                    className="text-xs font-medium text-ink"
                  >
                    LLM Model Identifier
                  </label>
                  <input
                    id="dictation-post-processing-model"
                    type="text"
                    data-testid="dictation-post-processing-model"
                    value={ppModel}
                    onChange={(e) => setPpModel(e.target.value)}
                    placeholder="openai/gpt-4o-mini"
                    className="w-full rounded border border-edge bg-highlight px-3 py-1 text-xs text-ink"
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-xs font-medium text-ink">OpenRouter API Key (Secret)</span>
                  <div className="flex items-center gap-2">
                    {postProcessing?.hasApiKey && !editingPpKey ? (
                      <>
                        <span
                          data-testid="pp-secret-preview"
                          className="font-mono text-xs text-ink"
                        >
                          ••••••••••••
                        </span>
                        <button
                          type="button"
                          data-testid="pp-secret-update"
                          onClick={() => setEditingPpKey(true)}
                          className="rounded border border-edge px-2 py-0.5 text-xs hover:bg-highlight"
                        >
                          Change
                        </button>
                        <button
                          type="button"
                          data-testid="pp-secret-clear"
                          onClick={handleClearPpKey}
                          className="rounded border border-edge px-2 py-0.5 text-xs text-error hover:bg-highlight"
                        >
                          Clear
                        </button>
                      </>
                    ) : (
                      <>
                        <input
                          id="dictation-pp-secret-input"
                          type="password"
                          data-testid="pp-secret-input"
                          value={ppKeyInput}
                          onChange={(e) => setPpKeyInput(e.target.value)}
                          placeholder="sk-or-v1-..."
                          className="flex-1 rounded border border-edge bg-highlight px-3 py-1 text-xs text-ink"
                        />
                        {editingPpKey ? (
                          <button
                            type="button"
                            data-testid="pp-secret-cancel"
                            onClick={() => {
                              setEditingPpKey(false)
                              setPpKeyInput('')
                            }}
                            className="rounded border border-edge px-2 py-0.5 text-xs hover:bg-highlight"
                          >
                            Cancel
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                data-testid="dictation-post-processing-save"
                disabled={savingPp}
                onClick={handleSavePostProcessing}
                className="rounded bg-button px-3 py-1 text-xs font-medium text-ink hover:bg-button-hover disabled:opacity-50"
              >
                {savingPp ? 'Saving...' : 'Save Post-Processing'}
              </button>
              {ppSaveStatus ? (
                <span data-testid="dictation-pp-save-status" className="text-xs text-success">
                  {ppSaveStatus}
                </span>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {/* OpenWhispr desktop shortcut method (AC-014) */}
      {desktopSelected && desktopDictation ? (
        <section className="space-y-3 rounded-md border border-edge p-4">
          <h4 className="font-semibold text-ink">OpenWhispr Desktop Shortcut (V1 Mode)</h4>
          <DesktopDictationSettings
            setup={desktopDictation.setup}
            saving={desktopDictation.saving || desktopDictation.control.busy}
            onChange={desktopDictation.configure}
          />
        </section>
      ) : null}
    </div>
  )
}
