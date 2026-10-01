import { vi } from 'vitest'

// Module-boundary mock for the Monaco bootstrap (jsdom cannot host a real
// editor). Tests assert NeKode's own wiring — createModel/create options,
// the context-menu commands (hasSelection/copy/selectAll) — not Monaco
// internals. Import this module in tests to inspect the instances the code
// under test constructed.

/** Standalone selection; mirrors the used fields of monaco.Selection. */
export class MockSelection {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}

  isEmpty(): boolean {
    return this.startLineNumber === this.endLineNumber && this.startColumn === this.endColumn
  }
}

export class MockModel {
  value: string
  disposed = false

  constructor(value: string) {
    this.value = value
  }

  getValueInRange(range: MockSelection): string {
    const lines = this.value.split('\n')
    if (range.startLineNumber === range.endLineNumber) {
      const line = lines[range.startLineNumber - 1] ?? ''
      return line.slice(range.startColumn - 1, range.endColumn - 1)
    }
    const first = (lines[range.startLineNumber - 1] ?? '').slice(range.startColumn - 1)
    const middle = lines.slice(range.startLineNumber, range.endLineNumber - 1)
    const last = (lines[range.endLineNumber - 1] ?? '').slice(0, range.endColumn - 1)
    return [first, ...middle, last].join('\n')
  }

  getFullModelRange(): MockSelection {
    const lines = this.value.split('\n')
    const lastColumn = (lines[lines.length - 1] ?? '').length + 1
    return new MockSelection(1, 1, lines.length, lastColumn)
  }

  dispose(): void {
    this.disposed = true
  }
}

export class MockEditor {
  options: unknown
  model: MockModel
  /** The selection the test put into the editor (null = collapsed cursor). */
  selection: MockSelection | null = null
  disposed = false

  constructor(model: MockModel) {
    this.model = model
  }

  getSelection(): MockSelection | null {
    return this.selection
  }

  setSelection(selection: MockSelection): void {
    this.selection = selection
  }

  dispose(): void {
    this.disposed = true
  }
}

export interface MockMonacoInstance {
  editor: {
    createModel: (value: string, language?: string) => MockModel
    create: (host: HTMLElement, options: unknown) => MockEditor
  }
}

export const mockModels: MockModel[] = []
export const mockEditors: MockEditor[] = []
export const mockOptions: unknown[] = []

export const monaco: MockMonacoInstance = {
  editor: {
    createModel: vi.fn((value: string, _language?: string) => {
      const model = new MockModel(value)
      mockModels.push(model)
      return model
    }),
    create: vi.fn((_host: HTMLElement, options: unknown) => {
      const editor = new MockEditor(mockModels[mockModels.length - 1])
      mockEditors.push(editor)
      mockOptions.push(options)
      return editor
    }),
  },
}

/** Reset captured instances between tests (call in beforeEach). */
export function resetMockMonaco(): void {
  mockModels.length = 0
  mockEditors.length = 0
  mockOptions.length = 0
}
