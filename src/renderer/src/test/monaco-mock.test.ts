import { beforeEach, describe, expect, it } from 'vitest'
import {
  MockModel,
  mockEditors,
  mockModels,
  mockOptions,
  monaco,
  resetMockMonaco,
} from './monaco-mock'

describe('monaco-mock editor.create model binding', () => {
  beforeEach(() => {
    resetMockMonaco()
  })

  it('binds the explicitly provided options.model', () => {
    const dummyHost = document.createElement('div')
    const model1 = monaco.editor.createModel('first model')
    const model2 = monaco.editor.createModel('second model')

    const editor = monaco.editor.create(dummyHost, { model: model1 })
    expect(editor.model).toBe(model1)
    expect(editor.getModel()).toBe(model1)
    expect(mockEditors).toHaveLength(1)
    expect(mockOptions).toEqual([{ model: model1 }])
    expect(editor.options).toEqual({ model: model1 })
    expect(model2.value).toBe('second model')
  })

  it('creates and binds a model from options.value when model is omitted', () => {
    const dummyHost = document.createElement('div')
    const editor = monaco.editor.create(dummyHost, { value: 'fallback text' })

    expect(editor.model).toBeInstanceOf(MockModel)
    expect(editor.model?.value).toBe('fallback text')
    expect(mockModels).toHaveLength(1)
  })

  it('leaves model as null when neither model nor value is provided', () => {
    const dummyHost = document.createElement('div')
    // Create an unrelated model prior to editor creation
    monaco.editor.createModel('unrelated text')

    const editor = monaco.editor.create(dummyHost, { theme: 'vs-dark' })
    expect(editor.model).toBeNull()
    expect(editor.getModel()).toBeNull()
  })
})
