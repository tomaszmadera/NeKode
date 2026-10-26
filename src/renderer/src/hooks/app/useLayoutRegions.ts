import { APP_STATE_KEY } from '@shared/ipc-contract'
import { useCallback, useState } from 'react'
import { errorMessage } from '../../lib/app-error-message'
import {
  BOTTOM_REGION_SIZE,
  clampRegionSize,
  LEFT_REGION_SIZE,
  type RegionSizeLimits,
  useResizableRegion,
} from '../useResizableRegion'
import type { AppApi, SetNotice } from './useWorkspaceRuntime'

export function parsePersistedSize(value: string | null, limits: RegionSizeLimits): number {
  if (value === null || value.trim().length === 0) {
    return limits.default
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? clampRegionSize(parsed, limits) : limits.default
}

/** Left panel width and bottom panel height, persisted when a resize ends. */
export function useLayoutRegions(app: AppApi, setNotice: SetNotice) {
  const [leftWidth, setLeftWidth] = useState(LEFT_REGION_SIZE.default)
  const [bottomHeight, setBottomHeight] = useState(BOTTOM_REGION_SIZE.default)

  const handleLeftResizeEnd = useCallback(
    (size: number): void => {
      void app.state.set(APP_STATE_KEY.leftRegionWidth, String(size)).catch((error: unknown) => {
        setNotice(errorMessage(error, 'Failed to save the panel width.'))
      })
    },
    [app, setNotice],
  )

  const handleBottomResizeEnd = useCallback(
    (size: number): void => {
      void app.state.set(APP_STATE_KEY.bottomRegionHeight, String(size)).catch((error: unknown) => {
        setNotice(errorMessage(error, 'Failed to save the panel height.'))
      })
    },
    [app, setNotice],
  )

  // Startup hydration of the persisted sizes (missing or invalid -> default).
  const restoreRegionSizes = useCallback(
    (savedLeftWidth: string | null, savedBottomHeight: string | null): void => {
      setLeftWidth(parsePersistedSize(savedLeftWidth, LEFT_REGION_SIZE))
      setBottomHeight(parsePersistedSize(savedBottomHeight, BOTTOM_REGION_SIZE))
    },
    [],
  )

  const leftRegion = useResizableRegion({
    axis: 'x',
    minSize: LEFT_REGION_SIZE.min,
    maxSize: LEFT_REGION_SIZE.max,
    size: leftWidth,
    onSizeChange: setLeftWidth,
    onResizeEnd: handleLeftResizeEnd,
  })
  const bottomRegion = useResizableRegion({
    axis: 'y',
    minSize: BOTTOM_REGION_SIZE.min,
    maxSize: BOTTOM_REGION_SIZE.max,
    size: bottomHeight,
    onSizeChange: setBottomHeight,
    onResizeEnd: handleBottomResizeEnd,
  })

  return { leftWidth, bottomHeight, leftRegion, bottomRegion, restoreRegionSizes }
}
