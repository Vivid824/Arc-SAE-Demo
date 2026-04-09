import type { EmbeddingCell } from './schema'

export type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type ScreenPoint = {
  x: number
  y: number
}

export type ViewTransform = {
  scale: number
  panX: number
  panY: number
}

export function computeBounds(cells: EmbeddingCell[]): Bounds {
  if (cells.length === 0) {
    return {
      minX: 0,
      maxX: 1,
      minY: 0,
      maxY: 1,
    }
  }

  const xValues = cells.map((cell) => cell.x)
  const yValues = cells.map((cell) => cell.y)

  return {
    minX: Math.min(...xValues),
    maxX: Math.max(...xValues),
    minY: Math.min(...yValues),
    maxY: Math.max(...yValues),
  }
}

export function createTransform(
  bounds: Bounds,
  width: number,
  height: number,
  padding = 24,
) {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1)
  const spanY = Math.max(bounds.maxY - bounds.minY, 1)
  const scale = Math.min(
    Math.max((width - padding * 2) / spanX, 1),
    Math.max((height - padding * 2) / spanY, 1),
  )
  const scaledWidth = spanX * scale
  const scaledHeight = spanY * scale
  const extraX = Math.max(0, width - padding * 2 - scaledWidth) / 2
  const extraY = Math.max(0, height - padding * 2 - scaledHeight) / 2
  const offsetX = padding + extraX
  const bottomOffset = padding + extraY

  return (x: number, y: number): ScreenPoint => ({
    x: offsetX + (x - bounds.minX) * scale,
    y: height - bottomOffset - (y - bounds.minY) * scale,
  })
}

export function computeCenteredFitTransform(
  bounds: Bounds,
  width: number,
  height: number,
  padding = 24,
): ViewTransform {
  const safeWidth = Math.max(width, 1)
  const safeHeight = Math.max(height, 1)
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6)
  const scale = Math.max(
    1e-6,
    Math.min(
      Math.max((safeWidth - padding * 2) / spanX, 1e-6),
      Math.max((safeHeight - padding * 2) / spanY, 1e-6),
    ),
  )

  const contentWidth = spanX * scale
  const contentHeight = spanY * scale

  return {
    scale,
    panX: (safeWidth - contentWidth) * 0.5 - bounds.minX * scale,
    panY: (safeHeight - contentHeight) * 0.5 - bounds.minY * scale,
  }
}

export function projectCells(
  cells: EmbeddingCell[],
) {
  return cells.map((cell) => ({ x: cell.x, y: cell.y }))
}

export function findNearestPoint(
  points: ScreenPoint[],
  x: number,
  y: number,
  radius = 6,
): { index: number; distance: number } | null {
  const radiusSquared = radius * radius
  let winner: { index: number; distance: number } | null = null

  points.forEach((point, index) => {
    const dx = point.x - x
    const dy = point.y - y
    const distance = dx * dx + dy * dy

    if (distance > radiusSquared) {
      return
    }

    if (!winner || distance < winner.distance) {
      winner = { index, distance }
    }
  })

  return winner
}
