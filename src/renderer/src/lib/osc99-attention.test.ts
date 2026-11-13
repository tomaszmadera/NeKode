import { describe, expect, it } from 'vitest'
import { createOsc99Attention } from './osc99-attention'

// Spec docs/features/chat-attention-badge/spec.md Behaviour 10-11, AC11-AC14.
// Bodies are what xterm's OSC 99 handler receives: the string after `99;`.

function base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
}

describe('createOsc99Attention', () => {
  it('AC11: answers the OpenCode capability query with its id', () => {
    expect(createOsc99Attention().take('i=opentui-notifications:p=?;')).toEqual({
      kind: 'reply',
      data: '\x1b]99;i=opentui-notifications:p=?;p=title,body\x1b\\',
    })
  })

  it('AC11: answers a query with a missing or invalid id as i=0', () => {
    const osc99 = createOsc99Attention()
    expect(osc99.take('p=?;')).toEqual({
      kind: 'reply',
      data: '\x1b]99;i=0:p=?;p=title,body\x1b\\',
    })
    expect(osc99.take('i=bad id:p=?;')).toEqual({
      kind: 'reply',
      data: '\x1b]99;i=0:p=?;p=title,body\x1b\\',
    })
    expect(osc99.take(`i=${'a'.repeat(65)}:p=?;`)).toMatchObject({
      data: '\x1b]99;i=0:p=?;p=title,body\x1b\\',
    })
  })

  it('AC11: ignores an echoed reply, so the exchange cannot loop', () => {
    expect(createOsc99Attention().take('i=opentui-notifications:p=?;p=title,body')).toBeNull()
  })

  it('AC12: a plain title notice raises attention with the title', () => {
    expect(createOsc99Attention().take('i=1;Build finished')).toEqual({
      kind: 'notice',
      message: 'Build finished',
    })
  })

  it('AC12: a base64 body notice decodes UTF-8', () => {
    expect(createOsc99Attention().take(`i=1:p=body:e=1;${base64('Zażółć gęślą')}`)).toEqual({
      kind: 'notice',
      message: 'Zażółć gęślą',
    })
  })

  it('AC12: a notice with no text raises attention without a message', () => {
    expect(createOsc99Attention().take('i=1;')).toEqual({ kind: 'notice', message: null })
  })

  it('AC13: holds d=0 chunks by id and joins title and body on the finishing chunk', () => {
    const osc99 = createOsc99Attention()
    expect(osc99.take('i=n1:d=0:p=title;OpenCode')).toBeNull()
    expect(osc99.take('i=n2:d=0:p=title;Other')).toBeNull()
    expect(osc99.take('i=n1:d=0:p=body;Needs ')).toBeNull()
    expect(osc99.take('i=n1:p=body;permission')).toEqual({
      kind: 'notice',
      message: 'OpenCode: Needs permission',
    })
    expect(osc99.take('i=n2:d=1:p=body;')).toEqual({ kind: 'notice', message: 'Other' })
    // The finished notification is gone; the same id starts fresh.
    expect(osc99.take('i=n1;Again')).toEqual({ kind: 'notice', message: 'Again' })
  })

  it('AC13: a finishing chunk of another kind still finishes the held notification', () => {
    const osc99 = createOsc99Attention()
    expect(osc99.take('i=n1:d=0:p=title;OpenCode')).toBeNull()
    expect(osc99.take('i=n1:d=0:p=icon;abc')).toBeNull()
    expect(osc99.take('i=n1:p=buttons;Allow')).toEqual({ kind: 'notice', message: 'OpenCode' })
  })

  it('AC14: a malformed OSC 99 without the payload separator raises nothing', () => {
    expect(createOsc99Attention().take('garbage')).toBeNull()
  })

  it('AC14: ignores close and other non-notice kinds', () => {
    const osc99 = createOsc99Attention()
    expect(osc99.take('i=1:p=close;')).toBeNull()
    expect(osc99.take('i=1:p=alive;')).toBeNull()
    expect(osc99.take('i=1:p=icon;abc')).toBeNull()
  })

  it('AC14: undecodable base64 raises nothing and drops the held chunks', () => {
    const osc99 = createOsc99Attention()
    expect(osc99.take('i=1:d=0;Title')).toBeNull()
    expect(osc99.take('i=1:p=body:e=1;***')).toBeNull()
    expect(osc99.take('i=1:p=body;tail')).toEqual({ kind: 'notice', message: 'tail' })
    expect(osc99.take(`i=2:e=1;${btoa('\xff\xfe')}`)).toBeNull()
  })
})
