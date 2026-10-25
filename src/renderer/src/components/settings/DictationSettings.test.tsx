import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DictationPostProcessingSettings,
  SttProviderSummary,
} from '../../../../shared/dictation-contract'
import { createDictationApiStub } from '../../test/dictation-api-stub'
import { DESKTOP_SHORTCUT_METHOD, DictationSettings } from './DictationSettings'

const mockElevenLabsSummary: SttProviderSummary = {
  id: 'elevenlabs',
  name: 'ElevenLabs Scribe v2',
  description: 'Batch audio transcription with Scribe v2',
  version: '1.0.0',
  capabilities: {
    keyterms: true,
    nativeEditing: true,
    languageSelection: true,
    modelDiscovery: false,
    timestamps: true,
  },
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'secret',
      required: true,
      placeholder: 'xi-...',
    },
    {
      key: 'language',
      label: 'Default Language',
      type: 'text',
      required: false,
      defaultValue: 'pl',
    },
    {
      key: 'enableNativeEdit',
      label: 'Enable Transcript Editing (+30% surcharge)',
      type: 'boolean',
      required: false,
      defaultValue: false,
    },
    {
      key: 'baseUrl',
      label: 'Base URL',
      type: 'url',
      required: false,
      defaultValue: 'https://api.elevenlabs.io',
    },
  ],
  configured: true,
}

const mockOpenRouterSummary: SttProviderSummary = {
  id: 'openrouter',
  name: 'OpenRouter STT',
  description: 'Audio transcription via OpenRouter models',
  version: '1.0.0',
  capabilities: {
    keyterms: false,
    nativeEditing: false,
    languageSelection: true,
    modelDiscovery: true,
    timestamps: false,
  },
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'secret',
      required: true,
      placeholder: 'sk-or-v1-...',
    },
    {
      key: 'model',
      label: 'Transcription Model',
      type: 'text',
      required: false,
      defaultValue: 'openai/whisper-large-v3-turbo',
    },
  ],
  configured: false,
}

const defaultPpSettings: DictationPostProcessingSettings = {
  mode: 'disabled',
  level: 'light',
  model: 'openai/gpt-4o-mini',
  hasApiKey: false,
}

const mockCloudSummary: SttProviderSummary = {
  id: 'openwhispr-cloud',
  name: 'OpenWhispr Cloud (beta)',
  version: '1.0.0',
  configured: false,
  description:
    'Sends audio and vocabulary hints to OpenWhispr Cloud. Requires Pro or Business. Beta limits: 4 MB per file, 600 minutes per calendar month, one transcription per key.',
  capabilities: {
    keyterms: true,
    nativeEditing: false,
    languageSelection: true,
    modelDiscovery: false,
    timestamps: false,
  },
  configSchema: [
    { key: 'apiKey', label: 'Personal API key', type: 'secret', required: true },
    {
      key: 'language',
      label: 'Language',
      type: 'select',
      required: false,
      defaultValue: 'pl',
      options: [
        { label: 'Polish', value: 'pl' },
        { label: 'Automatic', value: 'auto' },
      ],
    },
    {
      key: 'cloudUploadEnabled',
      label: 'Allow sending recordings and vocabulary hints to OpenWhispr Cloud',
      type: 'boolean',
      required: true,
      defaultValue: false,
    },
  ],
}

afterEach(cleanup)

describe('DictationSettings', () => {
  it('shows Cloud disclosure, initially unchecked permission, and saves permission separately from its key', async () => {
    const api = createDictationApiStub()
    const manifest = mockCloudSummary
    vi.mocked(api.providersList).mockResolvedValue([{ ...manifest, configured: false }])
    vi.mocked(api.getActiveProvider).mockResolvedValue(manifest.id)
    vi.mocked(api.providersGetConfig).mockResolvedValue({
      language: 'pl',
      cloudUploadEnabled: false,
    })
    render(<DictationSettings api={api} />)
    const permission = await screen.findByTestId('dictation-config-cloudUploadEnabled')
    expect(permission.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(manifest.description).textContent).toContain('600 minutes')
    expect(screen.getByText(manifest.description).textContent).toContain(
      'audio and vocabulary hints',
    )
    expect(screen.queryByTestId('dictation-config-model')).toBeNull()
    expect(screen.queryByTestId('dictation-config-baseUrl')).toBeNull()
    expect(screen.queryByTestId('dictation-refresh-models')).toBeNull()
    expect(screen.queryByTestId('dictation-config-enableNativeEdit')).toBeNull()
    fireEvent.change(screen.getByTestId('secret-input-apiKey'), {
      target: { value: 'owk_live_test_fixture' },
    })
    fireEvent.click(screen.getByTestId('dictation-save-config'))
    await waitFor(() =>
      expect(api.providersSetConfig).toHaveBeenCalledWith(manifest.id, {
        language: 'pl',
        cloudUploadEnabled: false,
        apiKey: 'owk_live_test_fixture',
      }),
    )
    await waitFor(() =>
      expect((screen.getByTestId('secret-input-apiKey') as HTMLInputElement).value).toBe(''),
    )
    vi.mocked(api.providersGetConfig).mockResolvedValue({
      language: 'pl',
      cloudUploadEnabled: true,
      apiKey: { configured: true, valid: true, lastFour: 'ture' },
    })
    fireEvent.click(permission)
    fireEvent.click(screen.getByTestId('dictation-save-config'))
    await waitFor(() =>
      expect(api.providersSetConfig).toHaveBeenLastCalledWith(manifest.id, {
        language: 'pl',
        cloudUploadEnabled: true,
      }),
    )
    await screen.findByTestId('secret-preview-apiKey')
    fireEvent.change(screen.getByTestId('dictation-config-language'), { target: { value: 'auto' } })
    fireEvent.click(screen.getByTestId('dictation-save-config'))
    await waitFor(() =>
      expect(api.providersSetConfig).toHaveBeenLastCalledWith(manifest.id, {
        language: 'auto',
        cloudUploadEnabled: true,
      }),
    )
    expect(document.body.textContent).not.toContain('owk_live_test_fixture')
  })
  it('loads providers list and displays active provider schema fields', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.providersList).mockResolvedValue([mockElevenLabsSummary, mockOpenRouterSummary])
    vi.mocked(api.getActiveProvider).mockResolvedValue('elevenlabs')
    vi.mocked(api.providersGetConfig).mockResolvedValue({
      apiKey: { configured: true, lastFour: '1234' },
      language: 'pl',
      enableNativeEdit: false,
    })
    vi.mocked(api.postProcessingGetSettings).mockResolvedValue(defaultPpSettings)

    render(<DictationSettings api={api} />)

    // Loading finishes
    await screen.findByTestId('dictation-provider-select')
    const providerSelect = screen.getByTestId('dictation-provider-select') as HTMLSelectElement
    expect(providerSelect.value).toBe('elevenlabs')

    // Schema fields for ElevenLabs are rendered
    expect(screen.getByText('ElevenLabs Scribe v2')).toBeTruthy()
    expect(screen.getByTestId('dictation-config-language')).toBeTruthy()
    expect(screen.getByTestId('dictation-config-enableNativeEdit')).toBeTruthy()
    expect(screen.getByTestId('dictation-config-baseUrl')).toBeTruthy()

    // Secret field is masked with lastFour preview
    expect(screen.getByTestId('secret-preview-apiKey').textContent).toBe('••••••••1234')
  })

  it('switches provider, calls setActiveProvider, and loads new schema', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.providersList).mockResolvedValue([mockElevenLabsSummary, mockOpenRouterSummary])
    vi.mocked(api.getActiveProvider).mockResolvedValue('elevenlabs')
    vi.mocked(api.providersGetConfig).mockImplementation(async (id) => {
      if (id === 'openrouter') {
        return { model: 'openai/whisper-large-v3-turbo' }
      }
      return { language: 'pl' }
    })
    vi.mocked(api.postProcessingGetSettings).mockResolvedValue(defaultPpSettings)

    render(<DictationSettings api={api} />)

    await screen.findByTestId('dictation-provider-select')
    const select = screen.getByTestId('dictation-provider-select')

    fireEvent.change(select, { target: { value: 'openrouter' } })

    await waitFor(() => {
      expect(api.setActiveProvider).toHaveBeenCalledWith('openrouter')
      expect(api.providersGetConfig).toHaveBeenCalledWith('openrouter')
    })

    // OpenRouter schema renders
    expect(screen.getByText('Provider Configuration (OpenRouter STT)')).toBeTruthy()
    expect(screen.getByTestId('dictation-config-model')).toBeTruthy()
    // ElevenLabs specific field is gone
    expect(screen.queryByTestId('dictation-config-enableNativeEdit')).toBeNull()
  })

  it('masks secret fields with lastFour and supports updating and clearing (AC-011)', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.providersList).mockResolvedValue([mockElevenLabsSummary])
    vi.mocked(api.getActiveProvider).mockResolvedValue('elevenlabs')
    vi.mocked(api.providersGetConfig).mockResolvedValue({
      apiKey: { configured: true, lastFour: '9abc' },
    })
    vi.mocked(api.postProcessingGetSettings).mockResolvedValue(defaultPpSettings)

    render(<DictationSettings api={api} />)

    await screen.findByTestId('secret-preview-apiKey')
    expect(screen.getByTestId('secret-preview-apiKey').textContent).toBe('••••••••9abc')
    expect(screen.queryByTestId('secret-input-apiKey')).toBeNull()

    fireEvent.click(screen.getByTestId('secret-update-apiKey'))
    expect(screen.getByTestId('secret-input-apiKey')).toBeTruthy()
    expect(screen.queryByTestId('secret-preview-apiKey')).toBeNull()
    fireEvent.click(screen.getByTestId('secret-cancel-apiKey'))
    expect(screen.getByTestId('secret-preview-apiKey').textContent).toBe('••••••••9abc')

    // Test Clear secret
    fireEvent.click(screen.getByTestId('secret-clear-apiKey'))

    await waitFor(() => {
      expect(api.providersSetConfig).toHaveBeenCalledWith(
        'elevenlabs',
        expect.objectContaining({ apiKey: '' }),
      )
    })

    // Mock config after clearing
    vi.mocked(api.providersGetConfig).mockResolvedValue({ apiKey: undefined })

    // Test Update secret
    fireEvent.click(screen.getByTestId('secret-update-apiKey'))

    const secretInput = screen.getByTestId('secret-input-apiKey') as HTMLInputElement
    expect(secretInput).toBeTruthy()
    fireEvent.change(secretInput, { target: { value: 'xi-new-key-value-9999' } })

    // Save configuration
    fireEvent.click(screen.getByTestId('dictation-save-config'))

    await waitFor(() => {
      expect(api.providersSetConfig).toHaveBeenCalledWith(
        'elevenlabs',
        expect.objectContaining({ apiKey: 'xi-new-key-value-9999' }),
      )
    })
  })

  it('displays explicit +30% API surcharge disclosure when ElevenLabs native editing is checked (AC-003)', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.providersList).mockResolvedValue([mockElevenLabsSummary])
    vi.mocked(api.getActiveProvider).mockResolvedValue('elevenlabs')
    vi.mocked(api.providersGetConfig).mockResolvedValue({
      enableNativeEdit: false,
    })
    vi.mocked(api.postProcessingGetSettings).mockResolvedValue(defaultPpSettings)

    render(<DictationSettings api={api} />)

    await screen.findByTestId('dictation-config-enableNativeEdit')
    expect(screen.queryByTestId('elevenlabs-surcharge-warning')).toBeNull()

    // Enable native editing checkbox
    const checkbox = screen.getByTestId('dictation-config-enableNativeEdit')
    fireEvent.click(checkbox)

    // Surcharge warning becomes visible
    const warning = await screen.findByTestId('elevenlabs-surcharge-warning')
    expect(warning.textContent).toContain('+30% API cost surcharge')
  })

  it('runs non-consuming Test Connection and renders visual status feedback (AC-005)', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.providersList).mockResolvedValue([mockElevenLabsSummary])
    vi.mocked(api.getActiveProvider).mockResolvedValue('elevenlabs')
    vi.mocked(api.providersGetConfig).mockResolvedValue({ language: 'pl' })
    vi.mocked(api.postProcessingGetSettings).mockResolvedValue(defaultPpSettings)

    // Success response
    vi.mocked(api.providersTestConnection).mockResolvedValueOnce({
      ok: true,
      message: 'Subscription valid. Character quota: 100,000.',
    })

    render(<DictationSettings api={api} />)

    await screen.findByTestId('dictation-test-connection')
    fireEvent.click(screen.getByTestId('dictation-test-connection'))

    await screen.findByTestId('dictation-test-success')
    expect(screen.getByTestId('dictation-test-success').textContent).toContain('Subscription valid')
    expect(api.providersTestConnection).toHaveBeenCalledWith('elevenlabs', expect.any(Object))

    // Failure response
    vi.mocked(api.providersTestConnection).mockResolvedValueOnce({
      ok: false,
      message: 'Invalid API key or subscription expired.',
    })

    fireEvent.click(screen.getByTestId('dictation-test-connection'))

    await screen.findByTestId('dictation-test-error')
    expect(screen.getByTestId('dictation-test-error').textContent).toContain('Invalid API key')
    expect(screen.queryByTestId('dictation-test-success')).toBeNull()
    expect(screen.getByTestId('secret-input-apiKey').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByTestId('secret-input-apiKey').className).toContain('border-error')
  })

  it('discovers models for providers with capabilities.modelDiscovery and updates selection', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.providersList).mockResolvedValue([mockOpenRouterSummary])
    vi.mocked(api.getActiveProvider).mockResolvedValue('openrouter')
    vi.mocked(api.providersGetConfig).mockResolvedValue({
      model: 'openai/whisper-large-v3-turbo',
    })
    vi.mocked(api.postProcessingGetSettings).mockResolvedValue(defaultPpSettings)
    vi.mocked(api.providersDiscoverModels).mockResolvedValue([
      { id: 'openai/whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo' },
      { id: 'meta-llama/llama-3.2-11b-vision-instruct', name: 'Llama 3.2 11B' },
    ])

    render(<DictationSettings api={api} />)

    await screen.findByTestId('dictation-refresh-models')
    fireEvent.click(screen.getByTestId('dictation-refresh-models'))

    await waitFor(() => {
      expect(api.providersDiscoverModels).toHaveBeenCalledWith('openrouter', expect.any(Object))
    })

    // Discovered models dropdown appears
    const discoveredSelect = await screen.findByTestId('dictation-discovered-models-select')
    expect(screen.getByText('Whisper Large v3 Turbo')).toBeTruthy()

    // Select discovered model
    fireEvent.change(discoveredSelect, {
      target: { value: 'meta-llama/llama-3.2-11b-vision-instruct' },
    })
    const modelInput = screen.getByTestId('dictation-config-model') as HTMLInputElement
    expect(modelInput.value).toBe('meta-llama/llama-3.2-11b-vision-instruct')
  })

  it('manages post-processing settings (mode, level, model, and secret OpenRouter key) (AC-008)', async () => {
    const api = createDictationApiStub()
    vi.mocked(api.providersList).mockResolvedValue([mockElevenLabsSummary])
    vi.mocked(api.getActiveProvider).mockResolvedValue('elevenlabs')
    vi.mocked(api.providersGetConfig).mockResolvedValue({})
    vi.mocked(api.postProcessingGetSettings).mockResolvedValue({
      mode: 'external_llm',
      level: 'medium',
      model: 'anthropic/claude-3.5-haiku',
      hasApiKey: true,
    })

    render(<DictationSettings api={api} />)

    await screen.findByTestId('dictation-post-processing-mode')
    const modeSelect = screen.getByTestId('dictation-post-processing-mode') as HTMLSelectElement
    expect(modeSelect.value).toBe('external_llm')

    const levelSelect = screen.getByTestId('dictation-post-processing-level') as HTMLSelectElement
    expect(levelSelect.value).toBe('medium')

    // Model and secret preview are visible for external_llm
    const modelInput = screen.getByTestId('dictation-post-processing-model') as HTMLInputElement
    expect(modelInput.value).toBe('anthropic/claude-3.5-haiku')
    expect(screen.getByTestId('pp-secret-preview').textContent).toBe('••••••••••••')

    // Edit level
    fireEvent.change(levelSelect, { target: { value: 'full' } })

    // Save post-processing
    fireEvent.click(screen.getByTestId('dictation-post-processing-save'))

    await waitFor(() => {
      expect(api.postProcessingSetSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'external_llm',
          level: 'full',
          model: 'anthropic/claude-3.5-haiku',
        }),
      )
    })
  })

  function desktopDictationStub(enabled: boolean, supported = true) {
    const stub: ReturnType<typeof import('../../hooks/useDesktopDictation').useDesktopDictation> = {
      setup: { supported, settings: { enabled, confirmed: enabled } },
      saving: false,
      configure: vi.fn(async () => true),
      control: {
        selected: enabled,
        busy: false,
        disabledReason: null,
        error: null,
        activate: vi.fn(),
      },
    }
    return stub
  }

  function mockElevenLabsApi() {
    const api = createDictationApiStub()
    vi.mocked(api.providersList).mockResolvedValue([mockElevenLabsSummary])
    vi.mocked(api.getActiveProvider).mockResolvedValue('elevenlabs')
    vi.mocked(api.providersGetConfig).mockResolvedValue({})
    vi.mocked(api.postProcessingGetSettings).mockResolvedValue(defaultPpSettings)
    return api
  }

  it('offers the OpenWhispr desktop shortcut as one exclusive dictation method (AC-014)', async () => {
    const api = mockElevenLabsApi()
    const desktop = desktopDictationStub(false)
    render(<DictationSettings api={api} desktopDictation={desktop} />)

    const select = (await screen.findByTestId('dictation-provider-select')) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('elevenlabs'))
    expect(screen.queryByText('OpenWhispr Desktop Shortcut (V1 Mode)')).toBeNull()

    await act(async () => {
      fireEvent.change(select, { target: { value: DESKTOP_SHORTCUT_METHOD } })
    })
    expect(desktop.configure).toHaveBeenCalledExactlyOnceWith({ enabled: true, confirmed: false })
    expect(api.setActiveProvider).not.toHaveBeenCalled()
  })

  it('shows only the shortcut panel while it is selected and turns it off for an STT adapter (AC-014)', async () => {
    const api = mockElevenLabsApi()
    const desktop = desktopDictationStub(true)
    render(<DictationSettings api={api} desktopDictation={desktop} />)

    const select = (await screen.findByTestId('dictation-provider-select')) as HTMLSelectElement
    await screen.findByText('OpenWhispr Desktop Shortcut (V1 Mode)')
    expect(select.value).toBe(DESKTOP_SHORTCUT_METHOD)
    expect(screen.getByRole('checkbox', { name: /I confirm OpenWhispr is running/ })).toBeTruthy()
    expect(screen.queryByTestId('dictation-post-processing-save')).toBeNull()

    await act(async () => {
      fireEvent.change(select, { target: { value: 'elevenlabs' } })
    })
    expect(desktop.configure).toHaveBeenCalledExactlyOnceWith({ enabled: false, confirmed: false })
    expect(api.setActiveProvider).toHaveBeenCalledWith('elevenlabs')
  })

  it('stays on the shortcut and shows the error when turning it off fails (AC-014)', async () => {
    const api = mockElevenLabsApi()
    const desktop = desktopDictationStub(true)
    vi.mocked(desktop.configure).mockResolvedValue(false)
    const view = render(<DictationSettings api={api} desktopDictation={desktop} />)

    const select = (await screen.findByTestId('dictation-provider-select')) as HTMLSelectElement
    await screen.findByText('OpenWhispr Desktop Shortcut (V1 Mode)')
    await act(async () => {
      fireEvent.change(select, { target: { value: 'elevenlabs' } })
    })
    expect(desktop.configure).toHaveBeenCalledExactlyOnceWith({ enabled: false, confirmed: false })
    expect(api.setActiveProvider).not.toHaveBeenCalled()
    expect(select.value).toBe(DESKTOP_SHORTCUT_METHOD)

    const failed = {
      ...desktop,
      control: {
        ...desktop.control,
        error: 'Desktop dictation settings could not save. Try again.',
      },
    }
    view.rerender(<DictationSettings api={api} desktopDictation={failed} />)
    expect(screen.getByTestId('dictation-method-error').textContent).toContain('could not save')
  })

  it('does not offer the shortcut method where desktop dictation is unsupported', async () => {
    const api = mockElevenLabsApi()
    render(<DictationSettings api={api} desktopDictation={desktopDictationStub(false, false)} />)
    const select = (await screen.findByTestId('dictation-provider-select')) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('elevenlabs'))
    expect(
      Array.from(select.options).some((option) => option.value === DESKTOP_SHORTCUT_METHOD),
    ).toBe(false)
  })
})
