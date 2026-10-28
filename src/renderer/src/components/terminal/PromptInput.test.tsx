import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { PromptInput } from './PromptInput'

afterEach(cleanup)

describe('desktop dictation prompt', () => {
  it('refuses an input removed before activation', async () => {
    const activate = vi.fn(async () => {})
    render(
      <PromptInput
        onSubmit={vi.fn()}
        dictation={{ disabledReason: null, busy: false, error: null, activate }}
      />,
    )
    screen.getByRole('textbox').remove()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dictation' }))
    })
    expect(activate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('focus')
  })
  it.each(['pointer', 'keyboard'])(
    'focuses its own draft end before %s activation without submitting',
    async (activation) => {
      const submit = vi.fn()
      const activate = vi.fn(async () => {
        expect(document.activeElement).toBe(inputs[1])
        expect(inputs[1].value).toBe('existing draft')
        expect(inputs[1].selectionStart).toBe(14)
        expect(inputs[1].selectionEnd).toBe(14)
      })
      const dictation = { disabledReason: null, busy: false, error: null, activate }
      render(
        <>
          <PromptInput onSubmit={submit} dictation={dictation} />
          <PromptInput onSubmit={submit} dictation={dictation} />
        </>,
      )
      const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
      fireEvent.change(inputs[1], { target: { value: 'existing draft' } })
      inputs[0].focus()
      const button = screen.getAllByRole('button', { name: 'Dictation' })[1]
      if (activation === 'keyboard') {
        button.focus()
        expect(document.activeElement).toBe(button)
        fireEvent.keyDown(button, { key: 'Enter' })
        // jsdom does not implement the browser's default action of synthesizing a click
        // from Enter on a focused button; dispatch the synthetic click resulting from Enter:
        await act(async () => {
          fireEvent.click(button)
        })
      } else {
        expect(document.activeElement).toBe(inputs[0])
        await act(async () => {
          fireEvent.click(button)
        })
      }
      expect(activate).toHaveBeenCalledOnce()
      expect(submit).not.toHaveBeenCalled()
      fireEvent.change(inputs[1], { target: { value: 'existing draft pasted text' } })
      expect(inputs[1].value).toBe('existing draft pasted text')
      expect(inputs[0].value).toBe('')
      expect(submit).not.toHaveBeenCalled()
    },
  )

  it('refuses absent focus and disabled or busy actions', async () => {
    const activate = vi.fn(async () => {})
    const dictation = { disabledReason: null, busy: false, error: null, activate }
    const view = render(<PromptInput onSubmit={vi.fn()} dictation={dictation} />)
    vi.spyOn(screen.getByRole('textbox'), 'focus').mockImplementation(() => {})
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dictation' }))
    })
    expect(activate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('focus')
    view.rerender(
      <PromptInput
        onSubmit={vi.fn()}
        dictation={{ ...dictation, disabledReason: 'Enable dictation in Settings.' }}
      />,
    )
    expect((screen.getByRole('button', { name: 'Dictation' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    view.rerender(<PromptInput onSubmit={vi.fn()} dictation={{ ...dictation, busy: true }} />)
    const busyButton = screen.getByRole('button', {
      name: 'Sending shortcut...',
    }) as HTMLButtonElement
    expect(busyButton.disabled).toBe(true)
    // Not wired at all (no control provided): the control renders disabled.
    view.rerender(<PromptInput onSubmit={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Dictation' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})

describe('prompt draft injection nonce tracking', () => {
  it.each(['enter', 'button'])(
    'preserves multiline injected text when submitted by %s',
    (method) => {
      const onSubmit = vi.fn()
      const text = 'Resume from handoffs/a.md\nFollow the instructions.'
      render(<PromptInput onSubmit={onSubmit} injected={{ text, nonce: 1 }} />)
      const input = screen.getByRole('textbox') as HTMLTextAreaElement
      expect(input.value).toBe(text)
      if (method === 'enter') fireEvent.keyDown(input, { key: 'Enter' })
      else fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith(text)
      expect(input.value).toBe('')
    },
  )

  it('does not submit on Shift+Enter or Enter during composition', () => {
    const onSubmit = vi.fn()
    render(<PromptInput onSubmit={onSubmit} injected={{ text: 'Draft', nonce: 1 }} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('applies injection once and ignores re-renders with the same nonce', () => {
    const onInjected = vi.fn()
    const view = render(
      <PromptInput
        onSubmit={vi.fn()}
        injected={{ text: 'initial draft', nonce: 1 }}
        onInjected={onInjected}
      />,
    )

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('initial draft')
    expect(onInjected).toHaveBeenCalledTimes(1)

    // User edits the prompt after injection:
    fireEvent.change(input, { target: { value: 'initial draft edited by user' } })
    expect(input.value).toBe('initial draft edited by user')

    // Re-render passes a fresh object with the same nonce (e.g. ChatWorkspace re-render):
    view.rerender(
      <PromptInput
        onSubmit={vi.fn()}
        injected={{ text: 'initial draft', nonce: 1 }}
        onInjected={onInjected}
      />,
    )

    // User's typed value must NOT be overwritten, and onInjected must not be called again:
    expect(input.value).toBe('initial draft edited by user')
    expect(onInjected).toHaveBeenCalledTimes(1)

    // A fresh injection with a new nonce DOES apply:
    view.rerender(
      <PromptInput
        onSubmit={vi.fn()}
        injected={{ text: 'new draft', nonce: 2 }}
        onInjected={onInjected}
      />,
    )
    expect(input.value).toBe('new draft')
    expect(onInjected).toHaveBeenCalledTimes(2)
  })
})

describe('unified dictation prompt workflow', () => {
  function createUnifiedDictationStub(
    overrides: Partial<import('./PromptInput').UnifiedDictationControl> = {},
  ): import('./PromptInput').UnifiedDictationControl {
    return {
      state: 'idle',
      isRecording: false,
      isTranscribing: false,
      isBusy: false,
      durationSeconds: 0,
      error: null,
      warning: null,
      result: null,
      rawText: null,
      text: null,
      hasModifiedTranscript: false,
      reverted: false,
      orphanedTranscripts: [],
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      reset: vi.fn(),
      revertToRaw: vi.fn(),
      restoreEdited: vi.fn(),
      dismissOrphaned: vi.fn(),
      consumeOrphaned: vi.fn(),
      ...overrides,
    }
  }

  it('reflects idle, recording, and transcribing states on the dictation button', async () => {
    const dictation = createUnifiedDictationStub()
    const view = render(
      <PromptInput onSubmit={vi.fn()} dictationControl={dictation} chatId="chat-1" />,
    )

    // Idle
    const button = screen.getByRole('button', { name: 'Dictation' })
    expect(button.textContent).toContain('Dictation')
    expect((button as HTMLButtonElement).disabled).toBe(false)

    await act(async () => {
      fireEvent.click(button)
    })
    expect(dictation.start).toHaveBeenCalledWith('chat-1')

    // Recording
    view.rerender(
      <PromptInput
        onSubmit={vi.fn()}
        dictationControl={createUnifiedDictationStub({
          ...dictation,
          state: 'recording',
          isRecording: true,
          isBusy: true,
          durationSeconds: 3,
        })}
        chatId="chat-1"
      />,
    )
    // The visible label is the accessible name, so the state is announced.
    expect(screen.getByRole('button', { name: 'Recording (3s)...' })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByTestId(TEST_ID.terminalPromptDictation))
    })
    expect(dictation.stop).toHaveBeenCalled()

    // Transcribing
    view.rerender(
      <PromptInput
        onSubmit={vi.fn()}
        dictationControl={createUnifiedDictationStub({
          ...dictation,
          state: 'transcribing',
          isTranscribing: true,
          isBusy: true,
        })}
        chatId="chat-1"
      />,
    )
    const transcribingButton = screen.getByRole('button', {
      name: 'Transcribing...',
    }) as HTMLButtonElement
    expect(transcribingButton.textContent).toContain('Transcribing...')
    expect(transcribingButton.disabled).toBe(true)
  })

  it('cancels active recording when Esc key is pressed (AC-012)', async () => {
    const cancel = vi.fn(async () => {})
    const onSubmit = vi.fn()
    const dictation = createUnifiedDictationStub({
      state: 'recording',
      isRecording: true,
      isBusy: true,
      cancel,
    })

    render(<PromptInput onSubmit={onSubmit} dictationControl={dictation} chatId="chat-1" />)
    const textarea = screen.getByRole('textbox')

    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('inserts transcription text into prompt on successful result', async () => {
    const dictation = createUnifiedDictationStub()
    const view = render(
      <PromptInput onSubmit={vi.fn()} dictationControl={dictation} chatId="chat-1" />,
    )
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    view.rerender(
      <PromptInput
        onSubmit={vi.fn()}
        dictationControl={createUnifiedDictationStub({
          result: {
            sessionId: 'sess-1',
            chatId: 'chat-1',
            outcome: 'success',
            text: 'npm test',
            warning: null,
            error: null,
            retryable: false,
          },
        })}
        chatId="chat-1"
      />,
    )
    expect(textarea.value).toBe('npm test')

    // Appending when input is already populated
    view.rerender(
      <PromptInput
        onSubmit={vi.fn()}
        dictationControl={createUnifiedDictationStub({
          result: {
            sessionId: 'sess-2',
            chatId: 'chat-1',
            outcome: 'success',
            text: '--watch',
            warning: null,
            error: null,
            retryable: false,
          },
        })}
        chatId="chat-1"
      />,
    )
    expect(textarea.value).toBe('npm test --watch')
  })

  it('renders RawTranscriptBanner when post-processing modified transcript and reverts/restores (AC-010)', async () => {
    const revertToRaw = vi.fn()
    const restoreEdited = vi.fn()
    const dictation = createUnifiedDictationStub({
      hasModifiedTranscript: true,
      rawText: 'npm test watch',
      text: 'npm test --watch',
      revertToRaw,
      restoreEdited,
      result: {
        sessionId: 'sess-raw',
        chatId: 'chat-1',
        outcome: 'success',
        text: 'npm test --watch',
        rawText: 'npm test watch',
        warning: null,
        error: null,
        retryable: false,
      },
    })

    const view = render(
      <PromptInput onSubmit={vi.fn()} dictationControl={dictation} chatId="chat-1" />,
    )
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('npm test --watch')

    const banner = screen.getByTestId('raw-transcript-banner')
    expect(banner.textContent).toContain('npm test watch')

    // Click revert to raw
    fireEvent.click(screen.getByTestId('revert-to-raw-transcript'))
    expect(textarea.value).toBe('npm test watch')
    expect(revertToRaw).toHaveBeenCalledOnce()

    // Banner now offers restore formatted
    view.rerender(<PromptInput onSubmit={vi.fn()} dictationControl={dictation} chatId="chat-1" />)
    const restoreButton = screen.getByTestId('restore-edited-transcript')
    fireEvent.click(restoreButton)
    expect(textarea.value).toBe('npm test --watch')
    expect(restoreEdited).toHaveBeenCalledOnce()

    // Dismiss banner
    fireEvent.click(screen.getByTestId('dismiss-transcript-banner'))
    expect(screen.queryByTestId('raw-transcript-banner')).toBeNull()
  })

  it('displays actionable error alert on failure', () => {
    const dictation = createUnifiedDictationStub({
      error: 'Microphone permission denied',
    })
    render(<PromptInput onSubmit={vi.fn()} dictationControl={dictation} />)
    expect(screen.getByRole('alert').textContent).toContain('Microphone permission denied')
  })

  it('displays warning alert when post-processing is rejected (AC-009)', () => {
    const dictation = createUnifiedDictationStub({
      warning: 'post-processing-rejected',
    })
    render(<PromptInput onSubmit={vi.fn()} dictationControl={dictation} />)
    expect(screen.getByRole('status').textContent).toContain(
      'Safety guardrails preserved original transcript.',
    )
  })

  it('renders OrphanedTranscriptBanner and inserts recovered transcript (AC-013)', () => {
    const dismissOrphaned = vi.fn()
    const dictation = createUnifiedDictationStub({
      orphanedTranscripts: [
        {
          sessionId: 'orphaned-1',
          chatId: 'chat-background',
          outcome: 'success',
          text: 'git push origin main',
          warning: null,
          error: null,
          retryable: false,
        },
      ],
      dismissOrphaned,
    })

    render(<PromptInput onSubmit={vi.fn()} dictationControl={dictation} chatId="chat-active" />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    expect(screen.getByTestId('orphaned-transcript-banner')).toBeTruthy()
    expect(screen.getByTestId('orphaned-transcript-banner').textContent).toContain(
      'chat-background',
    )

    fireEvent.click(screen.getByTestId('insert-orphaned-transcript'))
    expect(textarea.value).toBe('git push origin main')
    expect(dismissOrphaned).toHaveBeenCalledWith('orphaned-1')
  })

  it('shows the chat name on a recovered transcript when the chat is known', () => {
    const dictation = createUnifiedDictationStub({
      orphanedTranscripts: [
        {
          sessionId: 'orphaned-1',
          chatId: 'chat-background',
          outcome: 'success',
          text: 'git push origin main',
          warning: null,
          error: null,
          retryable: false,
        },
      ],
    })

    render(
      <PromptInput
        onSubmit={vi.fn()}
        dictationControl={dictation}
        chatId="chat-active"
        chatLabel={(id) => (id === 'chat-background' ? 'Deploy in NeKode' : id)}
      />,
    )

    const banner = screen.getByTestId('orphaned-transcript-banner')
    expect(banner.textContent).toContain('Recovered transcript for Deploy in NeKode')
    expect(banner.textContent).not.toContain('chat-background')
  })

  it('cancels in-flight transcription on Esc, also from the Dictation button (AC-012)', () => {
    const cancel = vi.fn(async () => {})
    render(
      <PromptInput
        onSubmit={vi.fn()}
        dictationControl={createUnifiedDictationStub({
          state: 'transcribing',
          isTranscribing: true,
          isBusy: true,
          cancel,
        })}
        chatId="chat-1"
      />,
    )
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    fireEvent.keyDown(screen.getByTestId(TEST_ID.terminalPromptDictation), { key: 'Escape' })
    expect(cancel).toHaveBeenCalledTimes(2)
  })

  it('moves focus to the prompt when dictation starts so Esc stays reachable', async () => {
    render(
      <PromptInput
        onSubmit={vi.fn()}
        dictationControl={createUnifiedDictationStub()}
        chatId="chat-1"
      />,
    )
    const button = screen.getByTestId(TEST_ID.terminalPromptDictation)
    button.focus()
    await act(async () => {
      fireEvent.click(button)
    })
    expect(document.activeElement).toBe(screen.getByRole('textbox'))
  })

  it('ignores a result addressed to another chat prompt', () => {
    const view = render(
      <PromptInput
        onSubmit={vi.fn()}
        dictationControl={createUnifiedDictationStub()}
        chatId="chat-1"
      />,
    )
    view.rerender(
      <PromptInput
        onSubmit={vi.fn()}
        dictationControl={createUnifiedDictationStub({
          result: {
            sessionId: 'sess-other',
            chatId: 'chat-2',
            outcome: 'success',
            text: 'not mine',
            warning: null,
            error: null,
            retryable: false,
          },
        })}
        chatId="chat-1"
      />,
    )
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  })

  it('reverts only the last dictated take and keeps text typed around it (AC-010)', () => {
    const control = createUnifiedDictationStub({
      result: {
        sessionId: 'sess-edit',
        chatId: 'chat-1',
        outcome: 'success',
        text: 'run tests',
        rawText: 'ran tests',
        warning: null,
        error: null,
        retryable: false,
      },
    })
    render(<PromptInput onSubmit={vi.fn()} dictationControl={control} chatId="chat-1" />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('run tests')

    fireEvent.change(textarea, { target: { value: 'run tests then run tests now' } })
    fireEvent.click(screen.getByTestId('revert-to-raw-transcript'))
    expect(textarea.value).toBe('run tests then ran tests now')

    fireEvent.change(textarea, { target: { value: 'typed by hand' } })
    fireEvent.click(screen.getByTestId('restore-edited-transcript'))
    expect(textarea.value).toBe('typed by hand')
  })

  it('uses the OpenWhispr desktop shortcut when it is the selected method (AC-014)', async () => {
    const activate = vi.fn(async () => {})
    const control = createUnifiedDictationStub()
    render(
      <PromptInput
        onSubmit={vi.fn()}
        dictation={{ selected: true, disabledReason: null, busy: false, error: null, activate }}
        dictationControl={control}
        chatId="chat-1"
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId(TEST_ID.terminalPromptDictation))
    })
    expect(activate).toHaveBeenCalledOnce()
    expect(control.start).not.toHaveBeenCalled()
  })

  it('uses the unified control when an STT adapter is the selected method', async () => {
    const activate = vi.fn(async () => {})
    const control = createUnifiedDictationStub()
    render(
      <PromptInput
        onSubmit={vi.fn()}
        dictation={{
          selected: false,
          disabledReason: 'Select the OpenWhispr desktop shortcut in Settings.',
          busy: false,
          error: null,
          activate,
        }}
        dictationControl={control}
        chatId="chat-1"
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId(TEST_ID.terminalPromptDictation))
    })
    expect(control.start).toHaveBeenCalledWith('chat-1')
    expect(activate).not.toHaveBeenCalled()
  })

  it('does not insert a shared take again when the prompt remounts (session retry)', () => {
    const inserted = new Set<string>()
    const control = createUnifiedDictationStub({
      markInserted: (id) => inserted.add(id),
      isInserted: (id) => inserted.has(id),
      result: {
        sessionId: 'sess-once',
        chatId: 'chat-1',
        outcome: 'success',
        text: 'npm run build',
        warning: null,
        error: null,
        retryable: false,
      },
    })
    const first = render(
      <PromptInput onSubmit={vi.fn()} dictationControl={control} chatId="chat-1" />,
    )
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('npm run build')
    first.unmount()

    render(<PromptInput onSubmit={vi.fn()} dictationControl={control} chatId="chat-1" />)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  })

  it("shows a take's error only in the prompt of the chat that recorded it", () => {
    const control = createUnifiedDictationStub({
      error: 'Microphone permission denied',
      result: {
        sessionId: 'sess-fail',
        chatId: 'chat-1',
        outcome: 'failed',
        text: '',
        warning: null,
        error: 'microphone-unavailable',
        retryable: false,
      },
    })
    const view = render(
      <PromptInput onSubmit={vi.fn()} dictationControl={control} chatId="chat-2" />,
    )
    expect(screen.queryByRole('alert')).toBeNull()
    view.rerender(<PromptInput onSubmit={vi.fn()} dictationControl={control} chatId="chat-1" />)
    expect(screen.getByRole('alert').textContent).toContain('Microphone permission denied')
  })

  it('keeps the shortcut method disabled until it is confirmed instead of recording in-app', () => {
    const control = createUnifiedDictationStub()
    render(
      <PromptInput
        onSubmit={vi.fn()}
        dictation={{
          selected: true,
          disabledReason: 'Confirm OpenWhispr Ctrl + Super / Tap in Settings.',
          busy: false,
          error: null,
          activate: vi.fn(async () => {}),
        }}
        dictationControl={control}
        chatId="chat-1"
      />,
    )
    const button = screen.getByTestId(TEST_ID.terminalPromptDictation) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toContain('Confirm OpenWhispr')
  })

  it('keeps Esc cancellation reachable without focusing the hidden draft in buttons-only mode', async () => {
    const control = createUnifiedDictationStub()
    const view = render(
      <PromptInput chrome="buttons" onSubmit={vi.fn()} dictationControl={control} />,
    )
    await act(async () => fireEvent.click(screen.getByTestId(TEST_ID.terminalPromptDictation)))
    expect(control.start).toHaveBeenCalledOnce()
    const form = screen.getByTestId(TEST_ID.terminalPromptSend).closest('form')
    expect(document.activeElement).toBe(form)
    view.rerender(
      <PromptInput
        chrome="buttons"
        onSubmit={vi.fn()}
        dictationControl={{ ...control, state: 'transcribing', isTranscribing: true, isBusy: true }}
      />,
    )
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(control.cancel).toHaveBeenCalledOnce()
  })

  it('pastes recovered dictation into the console in buttons-only mode', () => {
    const paste = vi.fn()
    const submit = vi.fn()
    const transcript = {
      sessionId: 'recovered-1',
      chatId: 'chat-background',
      outcome: 'success' as const,
      text: 'recovered text',
      warning: null,
      error: null,
      retryable: false,
    }
    const control = createUnifiedDictationStub({ orphanedTranscripts: [transcript] })
    render(
      <PromptInput
        chrome="buttons"
        onSubmit={submit}
        onPasteToTerminal={paste}
        dictationControl={control}
      />,
    )
    fireEvent.click(screen.getByTestId('insert-orphaned-transcript'))
    expect(paste).toHaveBeenCalledExactlyOnceWith('recovered text')
    expect(control.dismissOrphaned).toHaveBeenCalledWith('recovered-1')
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
    expect(submit).not.toHaveBeenCalled()
  })

  it('fails closed while the selected method is unknown instead of recording in-app', async () => {
    const control = createUnifiedDictationStub()
    render(
      <PromptInput
        onSubmit={vi.fn()}
        dictation={{
          selected: null,
          disabledReason: 'Loading desktop dictation settings.',
          busy: false,
          error: null,
          activate: vi.fn(async () => {}),
        }}
        dictationControl={control}
        chatId="chat-1"
      />,
    )
    const button = screen.getByTestId(TEST_ID.terminalPromptDictation) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await act(async () => {
      fireEvent.click(button)
    })
    expect(control.start).not.toHaveBeenCalled()
  })
})

describe('buttons-only prompt', () => {
  it('centers Dictation and Send with Send on the right, and sends Enter when empty', async () => {
    const submit = vi.fn()
    const focusTerminal = vi.fn(() => true)
    const activate = vi.fn(async () => {
      expect(focusTerminal).toHaveBeenCalledOnce()
    })
    render(
      <PromptInput
        chrome="buttons"
        onFocusTerminal={focusTerminal}
        onSubmit={submit}
        dictation={{ disabledReason: null, busy: false, error: null, activate }}
      />,
    )
    const form = screen.getByTestId(TEST_ID.terminalPromptSend).closest('form') as HTMLFormElement
    expect(form.getAttribute('data-prompt-chrome')).toBe('buttons')
    expect(form.className).toContain('justify-center')
    expect(form.querySelector('.nk-prompt-marker')).toBeNull()
    const dictation = screen.getByTestId(TEST_ID.terminalPromptDictation)
    const send = screen.getByTestId(TEST_ID.terminalPromptSend) as HTMLButtonElement
    expect(dictation.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    const field = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(field.className).toContain('sr-only')
    expect(field.tabIndex).toBe(-1)
    expect(send.disabled).toBe(false)

    fireEvent.click(send)
    expect(submit).toHaveBeenCalledWith('')

    fireEvent.change(field, { target: { value: 'git status' } })
    fireEvent.click(send)
    expect(submit).toHaveBeenLastCalledWith('git status')
    expect(field.value).toBe('')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dictation' }))
    })
    expect(activate).toHaveBeenCalledOnce()
    expect(submit).toHaveBeenCalledTimes(2)
  })
})
