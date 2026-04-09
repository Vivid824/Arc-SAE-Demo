export type HeatmapLayout = {
  padding: number
  gap: number
  cellWidth: number
  cellHeight: number
  gridWidth: number
  gridHeight: number
  totalWidth: number
  totalHeight: number
}

export function computeHeatmapLayout(
  columns: number,
  rows: number,
  {
    gap = 2,
    padding = 12,
    cellWidth = 20,
    cellHeight = 13,
  }: {
    gap?: number
    padding?: number
    cellWidth?: number
    cellHeight?: number
  } = {},
): HeatmapLayout {
  const safeColumns = Math.max(columns, 1)
  const safeRows = Math.max(rows, 1)
  const gridWidth = safeColumns * cellWidth + Math.max(safeColumns - 1, 0) * gap
  const gridHeight = safeRows * cellHeight + Math.max(safeRows - 1, 0) * gap

  return {
    padding,
    gap,
    cellWidth,
    cellHeight,
    gridWidth,
    gridHeight,
    totalWidth: gridWidth + padding * 2,
    totalHeight: gridHeight + padding * 2,
  }
}

export function findHeatmapCell(
  x: number,
  y: number,
  columns: number,
  rows: number,
  layout: HeatmapLayout,
) {
  const localX = x - layout.padding
  const localY = y - layout.padding
  if (localX < 0 || localY < 0) {
    return null
  }

  const strideX = layout.cellWidth + layout.gap
  const strideY = layout.cellHeight + layout.gap
  const column = Math.floor(localX / strideX)
  const row = Math.floor(localY / strideY)

  if (column < 0 || row < 0 || column >= columns || row >= rows) {
    return null
  }

  const offsetX = localX - column * strideX
  const offsetY = localY - row * strideY

  if (offsetX > layout.cellWidth || offsetY > layout.cellHeight) {
    return null
  }

  return { row, column }
}
