export interface MenuPositionOptions {
  /** Estimated or measured width of the menu in pixels. Defaults to 200. */
  menuWidth?: number
  /** Estimated or measured height of the menu in pixels. Defaults to 150. */
  menuHeight?: number
  /** Minimum padding in pixels from the viewport edges. Defaults to 8. */
  padding?: number
  /** Optional viewport width override in pixels (defaults to window.innerWidth). */
  viewportWidth?: number
  /** Optional viewport height override in pixels (defaults to window.innerHeight). */
  viewportHeight?: number
}

/**
 * Clamps context menu (x, y) coordinates so the menu remains entirely inside
 * the viewport, avoiding off-screen rendering when opened near edges.
 */
export function clampMenuPosition(
  x: number,
  y: number,
  options?: MenuPositionOptions,
): { left: number; top: number } {
  const padding = options?.padding ?? 8
  const width = options?.menuWidth ?? 200
  const height = options?.menuHeight ?? 150

  const viewportWidth =
    options?.viewportWidth ??
    (typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1024)
  const viewportHeight =
    options?.viewportHeight ??
    (typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 768)

  const maxLeft = Math.max(padding, viewportWidth - width - padding)
  const maxTop = Math.max(padding, viewportHeight - height - padding)

  return {
    left: Math.max(padding, Math.min(x, maxLeft)),
    top: Math.max(padding, Math.min(y, maxTop)),
  }
}
