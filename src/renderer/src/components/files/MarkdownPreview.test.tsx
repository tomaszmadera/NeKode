import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { MarkdownPreview } from './MarkdownPreview'

// The diagram itself belongs to MermaidDiagram's own test; here only the
// fence routing is asserted, so the stub stands in for the real component and
// the library is never imported (NEKODE-76).
vi.mock('./MermaidDiagram', () => ({
  MermaidDiagram: ({ source }: { source: string }) => (
    <div data-testid="mermaid-stub">{source}</div>
  ),
}))

const SAMPLE = [
  '# Title',
  '',
  'See [docs](https://example.com/docs) and [bad](javascript:alert(1)).',
  '',
  '<script>alert(1)</script>',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
  '- [x] Done',
  '',
  '| A | B |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '![diagram](https://example.com/diagram.png)',
].join('\n')

describe('MarkdownPreview', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders GFM and keeps raw HTML and unsafe links inert', () => {
    const { container } = render(<MarkdownPreview content={SAMPLE} />)
    const root = screen.getByTestId(TEST_ID.fileMarkdownRender)

    expect(root.querySelector('h1')?.textContent).toBe('Title')
    expect(root.querySelector('pre')?.textContent).toContain('const x = 1')
    expect(root.querySelector('table')?.textContent).toContain('1')
    const checkbox = root.querySelector('input[type="checkbox"]')
    expect(checkbox).toBeTruthy()
    expect((checkbox as HTMLInputElement).disabled).toBe(true)
    expect((checkbox as HTMLInputElement).checked).toBe(true)

    const link = screen.getByRole('link', { name: 'docs' })
    expect(link.getAttribute('href')).toBe('https://example.com/docs')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull()
    expect(root.textContent).toContain('bad')

    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('<script>')
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toContain('diagram')
  })

  it('routes every mermaid fence to a diagram and keeps other fences as code', () => {
    const withDiagrams = [
      '# Title',
      '',
      'See [docs](https://example.com/docs) and [bad](javascript:alert(1)).',
      '',
      '<script>alert(1)</script>',
      '',
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      '~~~mermaid',
      'sequenceDiagram',
      '~~~',
      '',
      '- item',
      '',
      '  ```mermaid',
      '  stateDiagram-v2',
      '  ```',
      '',
      '```ts',
      'const x = 1',
      '```',
      '',
      '```mermaid',
      '',
      '```',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '- [x] Done',
      '',
      '![diagram](https://example.com/diagram.png)',
    ].join('\n')

    const { container } = render(<MarkdownPreview content={withDiagrams} />)
    const root = screen.getByTestId(TEST_ID.fileMarkdownRender)

    // Backtick fence, tilde fence, and an indented fence inside a list item.
    const sources = Array.from(root.querySelectorAll('[data-testid="mermaid-stub"]')).map(
      (element) => element.textContent ?? '',
    )
    expect(sources.length).toBe(3)
    expect(sources[0]).toContain('flowchart LR')
    expect(sources[1]).toContain('sequenceDiagram')
    expect(sources[2]).toContain('stateDiagram-v2')

    // The TypeScript fence and the empty mermaid fence stay plain code blocks.
    const blocks = root.querySelectorAll('pre')
    expect(blocks.length).toBe(2)
    expect(blocks[0]?.textContent).toContain('const x = 1')

    // GFM and the preview's inert-content rules are unaffected beside a diagram.
    expect(root.querySelector('h1')?.textContent).toBe('Title')
    expect(root.querySelector('table')?.textContent).toContain('1')
    expect(root.querySelector('input[type="checkbox"]')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'docs' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull()
    expect(root.textContent).toContain('bad')
    expect(container.querySelector('script')).toBeNull()
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toContain('diagram')
  })
})
