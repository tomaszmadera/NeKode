import { describe, expect, it } from 'vitest'
import {
  type CtrlDAction,
  type CtrlDGateContext,
  decideCtrlDAction,
  isInputLineEmpty,
  splitCursorLine,
} from './ctrl-d-gate'

describe('ctrl-d-gate — pure decision table (C.4)', () => {
  interface TestCase {
    name: string
    context: CtrlDGateContext
    expectedAction: CtrlDAction
    expectedEmpty: boolean
  }

  const table: TestCase[] = [
    {
      name: 'startup before prompt draw with no input: closes session',
      context: {
        promptBase: null,
        baseFrozen: false,
        cursorLine: null,
        bufferType: 'normal',
      },
      expectedAction: 'eof',
      expectedEmpty: true,
    },
    {
      name: 'input arrived before prompt draw: unverifiable line emulates delete-char',
      context: {
        promptBase: null,
        baseFrozen: true,
        cursorLine: null,
        bufferType: 'normal',
      },
      expectedAction: 'delete',
      expectedEmpty: false,
    },
    {
      name: 'visibly empty prompt line with cursor at end: closes session',
      context: {
        promptBase: 'PS D:\\code> ',
        baseFrozen: false,
        cursorLine: { before: 'PS D:\\code> ', after: '' },
        bufferType: 'normal',
      },
      expectedAction: 'eof',
      expectedEmpty: true,
    },
    {
      name: 'frozen base with cursor sitting exactly at prompt end and nothing following: closes session',
      context: {
        promptBase: 'PS D:\\code> ',
        baseFrozen: true,
        cursorLine: { before: 'PS D:\\code> ', after: '' },
        bufferType: 'normal',
      },
      expectedAction: 'eof',
      expectedEmpty: true,
    },
    {
      name: 'text typed, cursor at end of line: emulates delete-char',
      context: {
        promptBase: 'PS D:\\code> ',
        baseFrozen: true,
        cursorLine: { before: 'PS D:\\code> git status', after: '' },
        bufferType: 'normal',
      },
      expectedAction: 'delete',
      expectedEmpty: false,
    },
    {
      name: 'text typed, cursor at prompt end (text remains after cursor): emulates delete-char',
      context: {
        promptBase: 'PS D:\\code> ',
        baseFrozen: true,
        cursorLine: { before: 'PS D:\\code> ', after: 'git status' },
        bufferType: 'normal',
      },
      expectedAction: 'delete',
      expectedEmpty: false,
    },
    {
      name: 'text typed, cursor in middle of input: emulates delete-char',
      context: {
        promptBase: 'PS D:\\code> ',
        baseFrozen: true,
        cursorLine: { before: 'PS D:\\code> git ', after: 'status' },
        bufferType: 'normal',
      },
      expectedAction: 'delete',
      expectedEmpty: false,
    },
    {
      name: 'cursor moved to column 0 before prompt: emulates delete-char',
      context: {
        promptBase: 'PS D:\\code> ',
        baseFrozen: true,
        cursorLine: { before: '', after: 'PS D:\\code> git status' },
        bufferType: 'normal',
      },
      expectedAction: 'delete',
      expectedEmpty: false,
    },
    {
      name: 'typed input visibly erased back to prompt base: closes session',
      context: {
        promptBase: 'PS D:\\code> ',
        baseFrozen: true,
        cursorLine: { before: 'PS D:\\code> ', after: '' },
        bufferType: 'normal',
      },
      expectedAction: 'eof',
      expectedEmpty: true,
    },
    {
      name: 'cursor line buffer unavailable: emulates delete-char',
      context: {
        promptBase: 'PS D:\\code> ',
        baseFrozen: true,
        cursorLine: null,
        bufferType: 'normal',
      },
      expectedAction: 'delete',
      expectedEmpty: false,
    },
    {
      name: 'cursor row repainted by asynchronous output (mismatched prefix): emulates delete-char',
      context: {
        promptBase: 'PS D:\\code> ',
        baseFrozen: true,
        cursorLine: { before: 'program output repaints this row!!', after: '' },
        bufferType: 'normal',
      },
      expectedAction: 'delete',
      expectedEmpty: false,
    },
    {
      name: 'alternate buffer (vim/htop) at empty line: passes through untouched (ignore)',
      context: {
        promptBase: 'PS D:\\code> ',
        baseFrozen: false,
        cursorLine: { before: 'PS D:\\code> ', after: '' },
        bufferType: 'alternate',
      },
      expectedAction: 'ignore',
      expectedEmpty: true,
    },
    {
      name: 'alternate buffer (vim/htop) with text: passes through untouched (ignore)',
      context: {
        promptBase: 'PS D:\\code> ',
        baseFrozen: true,
        cursorLine: { before: 'PS D:\\code> in vim', after: '' },
        bufferType: 'alternate',
      },
      expectedAction: 'ignore',
      expectedEmpty: false,
    },
    {
      name: 'alternate buffer without drawn prompt: passes through untouched (ignore)',
      context: {
        promptBase: null,
        baseFrozen: false,
        cursorLine: null,
        bufferType: 'alternate',
      },
      expectedAction: 'ignore',
      expectedEmpty: true,
    },
    {
      name: 'POSIX-style prompt empty line: closes session',
      context: {
        promptBase: 'user@box:~/repo$ ',
        baseFrozen: false,
        cursorLine: { before: 'user@box:~/repo$ ', after: '' },
        bufferType: 'normal',
      },
      expectedAction: 'eof',
      expectedEmpty: true,
    },
  ]

  it.each(table)('$name', ({ context, expectedAction, expectedEmpty }) => {
    expect(isInputLineEmpty(context.promptBase, context.baseFrozen, context.cursorLine)).toBe(
      expectedEmpty,
    )
    expect(decideCtrlDAction(context)).toBe(expectedAction)
  })
})

describe('ctrl-d-gate — splitCursorLine helper', () => {
  it('splits line at cursor position and right-trims text behind cursor', () => {
    expect(splitCursorLine('PS > abc    ', 5)).toEqual({
      before: 'PS > ',
      after: 'abc',
    })
    expect(splitCursorLine('PS > abc', 8)).toEqual({
      before: 'PS > abc',
      after: '',
    })
    expect(splitCursorLine('PS > abc', 0)).toEqual({
      before: '',
      after: 'PS > abc',
    })
    expect(splitCursorLine('PS > abc', 100)).toEqual({
      before: 'PS > abc',
      after: '',
    })
  })
})
