import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { MarkdownPreview } from './MarkdownPreview'

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
})
