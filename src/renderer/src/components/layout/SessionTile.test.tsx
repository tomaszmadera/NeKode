import type { ChatInfo } from '@shared/ipc-contract'
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testIdFor } from '../../lib/test-ids'
import { SessionTile } from './SessionTile'

// Session tile context readout (spec left-panel Behaviour): the tile shows the
// count in use and changes colour at 160k and 180k. No number means no real
// transcript, and then nothing renders (never a placeholder).
afterEach(cleanup)

const chat: ChatInfo = { id: 'c1', projectId: 'p1', name: '[PS7] Claude', agentName: 'Claude' }

function tile(contextTokens?: number): React.JSX.Element {
  return (
    <SessionTile
      chat={chat}
      label="Build the meter"
      projectName="Demo"
      folderName="demo"
      projectColor="#8b93f8"
      initials="DE"
      status="idle"
      active={false}
      contextTokens={contextTokens}
      attentionVisible={false}
      recentOutput={false}
      onSelect={vi.fn()}
    />
  )
}

describe('SessionTile context meter', () => {
  it('renders the count in use with a normal level far from the limit', () => {
    render(tile(64_611))
    const meter = screen.getByTestId(testIdFor.chatContext(chat.id))
    expect(meter.textContent).toBe('64.6k')
    expect(meter.getAttribute('data-level')).toBe('normal')
    expect(meter.getAttribute('title')).toContain('64,611 tokens')
  })

  it('switches to warning at 160k and critical at 180k', () => {
    const { rerender } = render(tile(160_000))
    expect(screen.getByTestId(testIdFor.chatContext(chat.id)).getAttribute('data-level')).toBe(
      'warning',
    )
    rerender(tile(180_000))
    expect(screen.getByTestId(testIdFor.chatContext(chat.id)).getAttribute('data-level')).toBe(
      'critical',
    )
  })

  it('renders nothing when the transcript is unavailable', () => {
    render(tile(undefined))
    expect(screen.queryByTestId(testIdFor.chatContext(chat.id))).toBeNull()
  })
})
