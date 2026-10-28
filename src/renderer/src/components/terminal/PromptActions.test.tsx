import type { DictationResult } from '@shared/contracts/dictation-contract'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptActions, type UnifiedDictationControl } from './PromptActions'

afterEach(cleanup)

function control(overrides: Partial<UnifiedDictationControl> = {}): UnifiedDictationControl {
  return {
    state: 'idle',
    isRecording: false,
    isTranscribing: false,
    isBusy: false,
    error: null,
    warning: null,
    result: null,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    ...overrides,
  }
}

const result: DictationResult = {
  sessionId: 'take-1',
  chatId: 'chat-1',
  outcome: 'success',
  text: 'Formatted take',
  rawText: 'raw take',
  warning: null,
  error: null,
  retryable: false,
}

describe('terminal actions', () => {
  it('renders Dictation then Send without any text field and sends on click', () => {
    const onSend = vi.fn()
    const { container } = render(<PromptActions onSend={onSend} />)
    expect(container.querySelector('input, textarea')).toBeNull()
    const [dictation, send] = screen.getAllByRole('button')
    expect(dictation.textContent).toBe('Dictation')
    expect(send.textContent).toContain('Send')
    fireEvent.click(send)
    expect(onSend).toHaveBeenCalledOnce()
  })

  it('waits for the console before pasting an injection and consumes each nonce once', () => {
    const onSend = vi.fn()
    const onInjected = vi.fn()
    const onPasteToTerminal = vi.fn()
    const props = {
      onSend,
      onInjected,
      injected: { text: 'Resume\nFollow instructions.', nonce: 1 },
    }
    const view = render(<PromptActions {...props} />)
    expect(onInjected).not.toHaveBeenCalled()
    view.rerender(<PromptActions {...props} onPasteToTerminal={onPasteToTerminal} />)
    expect(onPasteToTerminal).toHaveBeenCalledExactlyOnceWith(props.injected.text)
    expect(onInjected).toHaveBeenCalledOnce()
    view.rerender(
      <PromptActions
        {...props}
        injected={{ ...props.injected }}
        onPasteToTerminal={onPasteToTerminal}
      />,
    )
    expect(onPasteToTerminal).toHaveBeenCalledOnce()
    view.rerender(
      <PromptActions
        {...props}
        injected={{ ...props.injected, nonce: 2 }}
        onPasteToTerminal={onPasteToTerminal}
      />,
    )
    expect(onPasteToTerminal).toHaveBeenCalledTimes(2)
    expect(onInjected).toHaveBeenCalledTimes(2)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('focuses the console before dispatching desktop dictation and refuses failed focus', async () => {
    const onFocusTerminal = vi.fn(() => true)
    const activate = vi.fn(async () => {
      expect(onFocusTerminal).toHaveBeenCalledOnce()
    })
    const props = {
      onSend: vi.fn(),
      onFocusTerminal,
      dictation: { selected: true, disabledReason: null, busy: false, error: null, activate },
    }
    render(<PromptActions {...props} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dictation' })))
    expect(activate).toHaveBeenCalledOnce()
    onFocusTerminal.mockReturnValue(false)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dictation' })))
    expect(activate).toHaveBeenCalledOnce()
    expect(screen.getByRole('alert').textContent).toContain('console cannot receive focus')
    expect(props.onSend).not.toHaveBeenCalled()
  })

  it.each([null, true])(
    'keeps an unconfigured desktop method disabled (selected: %s)',
    (selected) => {
      const unified = control()
      const activate = vi.fn()
      render(
        <PromptActions
          onSend={vi.fn()}
          dictationControl={unified}
          dictation={{
            selected,
            disabledReason: 'Confirm setup in Settings.',
            busy: false,
            error: null,
            activate,
          }}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Dictation' }))
      expect(
        (screen.getByRole('button', { name: 'Dictation' }) as HTMLButtonElement).disabled,
      ).toBe(true)
      expect(unified.start).not.toHaveBeenCalled()
      expect(activate).not.toHaveBeenCalled()
    },
  )

  it('starts and stops recording, keeps Esc reachable while transcribing, and cancels', async () => {
    const unified = control()
    const onSend = vi.fn()
    const view = render(
      <PromptActions onSend={onSend} chatId="chat-1" dictationControl={unified} />,
    )
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dictation' })))
    expect(unified.start).toHaveBeenCalledWith('chat-1')
    const form = screen.getByRole('button', { name: 'Send' }).closest('form')
    expect(document.activeElement).toBe(form)
    view.rerender(
      <PromptActions
        onSend={onSend}
        dictationControl={{
          ...unified,
          state: 'recording',
          isRecording: true,
          isBusy: true,
          durationSeconds: 3,
        }}
      />,
    )
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Recording (3s)...' })),
    )
    expect(unified.stop).toHaveBeenCalledOnce()
    view.rerender(
      <PromptActions
        onSend={onSend}
        dictationControl={{ ...unified, state: 'transcribing', isTranscribing: true, isBusy: true }}
      />,
    )
    expect(
      (screen.getByRole('button', { name: 'Transcribing...' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(document.activeElement).toBe(form)
    fireEvent.keyDown(form as HTMLFormElement, { key: 'Escape' })
    expect(unified.cancel).toHaveBeenCalledOnce()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('pastes a successful take only into its addressed console, once, without submitting', () => {
    const onPasteToTerminal = vi.fn()
    const onSend = vi.fn()
    const markInserted = vi.fn()
    const unified = control({ result, markInserted })
    const props = { onSend, dictationControl: unified, onPasteToTerminal }
    const view = render(<PromptActions {...props} chatId="chat-2" />)
    expect(onPasteToTerminal).not.toHaveBeenCalled()
    view.rerender(<PromptActions {...props} chatId="chat-1" />)
    expect(onPasteToTerminal).toHaveBeenCalledExactlyOnceWith(result.text)
    expect(markInserted).toHaveBeenCalledWith(result.sessionId)
    view.rerender(
      <PromptActions
        {...props}
        chatId="chat-1"
        dictationControl={{ ...unified, result: { ...result } }}
      />,
    )
    expect(onPasteToTerminal).toHaveBeenCalledOnce()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('waits for the console before marking a take inserted and does not repeat it after remount', () => {
    const onPasteToTerminal = vi.fn()
    const markInserted = vi.fn()
    const isInserted = vi.fn(() => false)
    const unified = control({ result, markInserted, isInserted })
    const props = { onSend: vi.fn(), chatId: 'chat-1', dictationControl: unified }
    const view = render(<PromptActions {...props} />)
    expect(markInserted).not.toHaveBeenCalled()
    view.rerender(<PromptActions {...props} onPasteToTerminal={onPasteToTerminal} />)
    expect(onPasteToTerminal).toHaveBeenCalledOnce()
    view.unmount()
    isInserted.mockReturnValue(true)
    render(<PromptActions {...props} onPasteToTerminal={onPasteToTerminal} />)
    expect(onPasteToTerminal).toHaveBeenCalledOnce()
  })

  it('pastes a recovered transcript and dismisses it only when the console is available', () => {
    const dismissOrphaned = vi.fn()
    const onPasteToTerminal = vi.fn()
    const props = {
      onSend: vi.fn(),
      dictationControl: control({ orphanedTranscripts: [result], dismissOrphaned }),
      chatLabel: () => 'First chat in Demo',
    }
    const view = render(<PromptActions {...props} />)
    expect(screen.getByTestId('orphaned-transcript-banner').textContent).toContain(
      'First chat in Demo',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Insert transcript' }))
    expect(dismissOrphaned).not.toHaveBeenCalled()
    view.rerender(<PromptActions {...props} onPasteToTerminal={onPasteToTerminal} />)
    fireEvent.click(screen.getByRole('button', { name: 'Insert transcript' }))
    expect(onPasteToTerminal).toHaveBeenCalledExactlyOnceWith(result.text)
    expect(dismissOrphaned).toHaveBeenCalledExactlyOnceWith(result.sessionId)
    expect(props.onSend).not.toHaveBeenCalled()
  })

  it('shows errors and guardrail warnings only in the chat that owns the result', () => {
    const unified = control({
      result: { ...result, outcome: 'failed' },
      error: 'Check the provider key.',
      warning: 'post-processing-rejected',
    })
    const props = { onSend: vi.fn(), dictationControl: unified }
    const view = render(<PromptActions {...props} chatId="chat-2" />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    view.rerender(<PromptActions {...props} chatId="chat-1" />)
    expect(screen.getByRole('alert').textContent).toBe('Check the provider key.')
    expect(screen.getByRole('status').textContent).toContain('preserved original transcript')
  })
})
