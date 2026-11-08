import { fireEvent } from '@testing-library/react'

// Project names select the project and open its home tab; the row's chevron
// and avatar toggle expansion (project-home spec Behaviour 4).
export function openProjectHome(element: HTMLElement): void {
  fireEvent.click(element)
}
