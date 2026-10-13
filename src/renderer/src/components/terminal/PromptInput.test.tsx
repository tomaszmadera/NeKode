import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    expect((screen.getByRole('button', { name: 'Dictation' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(screen.getByRole('button', { name: 'Dictation' }).textContent).toContain(
      'Sending shortcut',
    )
    // Not wired at all (no control provided): the control renders disabled.
    view.rerender(<PromptInput onSubmit={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Dictation' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})

describe('prompt draft injection nonce tracking', () => {
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
