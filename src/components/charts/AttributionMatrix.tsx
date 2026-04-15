import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createSequentialScale } from '../../lib/color'
import { computeHeatmapLayout, findHeatmapCell } from '../../lib/heatmapMath'

type HoverState = {
  row: number
  column: number
  x: number
  y: number
}

type AttributionMatrixProps = {
  values: number[][]
  rowLabels: string[]
  columnLabels: string[]
  selectedPerturbationId: string | null
}

// Attribution uses a different color scale: white → purple for 0-3 range
const scale = createSequentialScale('#FFFFFF', '#6B46C1')
const rowLabelColumnWidth = 96
const headerRowHeight = 28

export function AttributionMatrix({
  values,
  rowLabels,
  columnLabels,
  selectedPerturbationId,
}: AttributionMatrixProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [containerWidth, setContainerWidth] = useState(640)
  const [hovered, setHovered] = useState<HoverState | null>(null)

  const flattened = useMemo(
    () => values.flat().map((value) => (Number.isFinite(value) ? value : 0)),
    [values],
  )
  const min = 0 // Attribution scores start at 0
  const max = Math.max(3, flattened.length > 0 ? Math.max(...flattened) : 3) // At least 3.0 range
  const rowCount = values.length
  const columnCount = values[0]?.length ?? 0
  const selectedRowIndex = selectedPerturbationId
    ? rowLabels.findIndex((label) => label === selectedPerturbationId)
    : -1
  const layout = useMemo(
    () => computeHeatmapLayout(columnCount, rowCount),
    [columnCount, rowCount],
  )

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }

      setContainerWidth(Math.max(320, Math.floor(entry.contentRect.width)))
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(layout.totalWidth * dpr)
    canvas.height = Math.floor(layout.totalHeight * dpr)
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, layout.totalWidth, layout.totalHeight)

    values.forEach((row, rowIndex) => {
      row.forEach((value, columnIndex) => {
        const x = layout.padding + columnIndex * (layout.cellWidth + layout.gap)
        const y = layout.padding + rowIndex * (layout.cellHeight + layout.gap)
        const safeValue = Number.isFinite(value) ? value : 0

        context.fillStyle = scale(safeValue, min, max)
        context.fillRect(x, y, layout.cellWidth, layout.cellHeight)
      })
    })

    if (selectedRowIndex >= 0 && selectedRowIndex < rowCount) {
      const y = layout.padding + selectedRowIndex * (layout.cellHeight + layout.gap)
      context.fillStyle = 'rgba(107, 70, 193, 0.12)'
      context.fillRect(layout.padding, y, layout.gridWidth, layout.cellHeight)
      context.fillStyle = '#6B46C1'
      context.fillRect(layout.padding - 2, y, 2, layout.cellHeight)
      context.strokeStyle = '#6B46C1'
      context.lineWidth = 2
      context.strokeRect(
        layout.padding - 1,
        y - 1,
        layout.gridWidth + 2,
        layout.cellHeight + 2,
      )
    }

    if (hovered) {
      const x = layout.padding + hovered.column * (layout.cellWidth + layout.gap)
      const y = layout.padding + hovered.row * (layout.cellHeight + layout.gap)
      context.lineWidth = 2
      context.strokeStyle = '#0D1117'
      context.strokeRect(x, y, layout.cellWidth, layout.cellHeight)
    }
  }, [columnCount, hovered, layout, max, min, rowCount, selectedRowIndex, values])

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const containerRect = containerRef.current?.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const hit = findHeatmapCell(x, y, columnCount, rowCount, layout)

    if (!hit || !containerRect) {
      setHovered(null)
      return
    }

    setHovered({
      ...hit,
      x: event.clientX - containerRect.left,
      y: event.clientY - containerRect.top,
    })
  }

  const hoveredRowLabel = hovered ? rowLabels[hovered.row] ?? `Row ${hovered.row + 1}` : null
  const hoveredColumnLabel = hovered
    ? columnLabels[hovered.column] ?? `Feature ${hovered.column + 1}`
    : null
  const hoveredValue = hovered ? (values[hovered.row]?.[hovered.column] ?? 0).toFixed(3) : null
  const tooltipMaxLeft = Math.max(140, containerWidth - 220)

  return (
    <div className="chart-card">
      <div className="chart-card-header">
        <div
          className="chart-card-row-labels"
          style={{ width: `${rowLabelColumnWidth}px` }}
          aria-hidden
        >
          <div style={{ height: `${headerRowHeight}px` }} />
          {rowLabels.map((label, index) => {
            const isSelected = index === selectedRowIndex
            return (
              <div
                key={`row-${label}-${index}`}
                className={`chart-card-row-label ${isSelected ? 'chart-card-row-label-selected' : ''}`}
                style={{
                  height: `${layout.cellHeight}px`,
                  marginBottom: `${layout.gap}px`,
                }}
              >
                <span className="chart-card-row-label-text">{label}</span>
              </div>
            )
          })}
        </div>
        <div className="chart-card-canvas-wrapper">
          <div className="chart-card-column-labels" style={{ height: `${headerRowHeight}px` }}>
            {columnLabels.map((label, index) => (
              <div
                key={`col-${label}-${index}`}
                className="chart-card-column-label"
                style={{
                  width: `${layout.cellWidth}px`,
                  marginRight: `${layout.gap}px`,
                }}
              >
                <span className="chart-card-column-label-text">{label}</span>
              </div>
            ))}
          </div>
          <div className="chart-card-canvas-container" ref={containerRef}>
            <canvas
              ref={canvasRef}
              width={layout.totalWidth}
              height={layout.totalHeight}
              style={{
                width: `${layout.totalWidth}px`,
                height: `${layout.totalHeight}px`,
              }}
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setHovered(null)}
            />
            {hovered && (
              <div
                className="chart-tooltip"
                style={
                  {
                    '--tooltip-left': `${Math.min(hovered.x + 12, tooltipMaxLeft)}px`,
                    '--tooltip-top': `${hovered.y + 12}px`,
                  } as CSSProperties
                }
              >
                <div className="chart-tooltip-row">
                  <strong>{hoveredRowLabel}</strong>
                  <span>{hoveredColumnLabel}</span>
                </div>
                <div className="chart-tooltip-row">
                  <span className="chart-tooltip-label">Attribution:</span>
                  <span>{hoveredValue}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
