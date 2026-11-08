import { fireEvent, screen } from '@testing-library/react'

// Project rows toggle expansion; the context menu retains the home action.
export function openProjectHome(element: HTMLElement): void {
  fireEvent.contextMenu(element)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Open project tasks' }))
}
