const DEFAULT_EDGE_THRESHOLD = 48
const DEFAULT_TOP_THRESHOLD = 80

interface Rectangle { x: number; y: number; width: number; height: number }
interface DockOptions { edgeThreshold?: number; topThreshold?: number }

function isRectangle(bounds: unknown): bounds is Rectangle {
  if (!bounds || typeof bounds !== 'object') return false
  const value = bounds as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(value[key])))
}

export function isOverlayAtDockCorner(overlayBounds: unknown, targetBounds: unknown, options: DockOptions = {}): boolean {
  if (!isRectangle(overlayBounds) || !isRectangle(targetBounds)) return false
  const edgeThreshold = Number.isFinite(options.edgeThreshold) ? options.edgeThreshold : DEFAULT_EDGE_THRESHOLD
  const topThreshold = Number.isFinite(options.topThreshold) ? options.topThreshold : DEFAULT_TOP_THRESHOLD
  const overlayRight = Number(overlayBounds.x) + Number(overlayBounds.width)
  const targetRight = Number(targetBounds.x) + Number(targetBounds.width)
  const topDistance = Math.abs(Number(overlayBounds.y) - Number(targetBounds.y))
  const rightDistance = Math.abs(overlayRight - targetRight)
  const horizontallyOverlaps = Number(overlayBounds.x) < targetRight && overlayRight > Number(targetBounds.x)

  return horizontallyOverlaps && rightDistance <= edgeThreshold && topDistance <= topThreshold
}

export const layoutDockingInternals = { DEFAULT_EDGE_THRESHOLD, DEFAULT_TOP_THRESHOLD }
