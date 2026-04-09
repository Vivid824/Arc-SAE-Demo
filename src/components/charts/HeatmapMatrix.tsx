import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createSequentialScale } from '../../lib/color'
import { computeHeatmapLayout, findHeatmapCell } from '../../lib/heatmapMath'

type HoverState = {
  row: number
  column: number
  x: number
  y: number
}

type HeatmapMatrixProps = {
  values: number[][]
  rowLabels: string[]
  columnLabels: string[]
  selectedPerturbationId: string | null
}

const scale = createSequentialScale('#EEF2FF', '#534AB7')
const rowLabelColumnWidth = 96
const headerRowHeight = 28

export function HeatmapMatrix({
  values,
  rowLabels,
  columnLabels,
  selectedPerturbationId,
}: HeatmapMatrixProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [containerWidth, setContainerWidth] = useState(640)
  const [hovered, setHovered] = useState<HoverState | null>(null)

  const flattened = useMemo(
    () => values.flat().map((value) => (Number.isFinite(value) ? value : 0)),
    [values],
  )
  const min = flattened.length > 0 ? Math.min(...flattened) : 0
  const max = flattened.length > 0 ? Math.max(...flattened) : 1
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
      context.fillStyle = 'rgba(83, 74, 183, 0.12)'
      context.fillRect(layout.padding, y, layout.gridWidth, layout.cellHeight)
      context.fillStyle = '#534AB7'
      context.fillRect(layout.padding - 2, y, 2, layout.cellHeight)
      context.strokeStyle = '#534AB7'
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
        <div>
          <h2 className="section-title">Feature x perturbation heatmap</h2>
          <p className="section-copy">
            Normalized per-feature max for display only. {rowCount} perturbations x {columnCount} features shown.
          </p>
        </div>
      </div>
      <div ref={containerRef} className="chart-stage heatmap-stage">
        <div className="heatmap-layout">
          <div className="heatmap-fixed-column">
            <div className="heatmap-corner-spacer" style={{ height: headerRowHeight }} />
            <div
              className="heatmap-row-labels"
              style={
                {
                  width: rowLabelColumnWidth,
                  height: layout.totalHeight,
                  ['--row-count' as string]: String(Math.max(1, rowCount)),
                  ['--row-height' as string]: `${layout.cellHeight}px`,
                  ['--row-gap' as string]: `${layout.gap}px`,
                  ['--row-padding' as string]: `${layout.padding}px`,
                } as CSSProperties
              }
            >
              {rowLabels.map((label, index) => (
                <div
                  key={`${label}-${index}`}
                  className={`heatmap-row-label${index === selectedRowIndex ? ' is-selected' : ''}`}
                  title={label}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>

          <div className="heatmap-scroll-area">
            <div
              className="heatmap-scroll-stack"
              style={{ width: layout.totalWidth, minWidth: layout.totalWidth }}
            >
              <div
                className="heatmap-column-labels"
                style={{
                  height: headerRowHeight,
                  paddingLeft: layout.padding,
                  paddingRight: layout.padding,
                }}
              >
                {columnLabels.map((label, index) => (
                  <div
                    key={`${label}-${index}`}
                    className="heatmap-column-label"
                    style={{ width: layout.cellWidth, marginRight: index === columnLabels.length - 1 ? 0 : layout.gap }}
                    title={label}
                  >
                    <span>{label}</span>
                  </div>
                ))}
              </div>

              <canvas
                ref={canvasRef}
                className="chart-canvas heatmap-canvas"
                onPointerMove={handlePointerMove}
                onPointerLeave={() => setHovered(null)}
                style={{ width: layout.totalWidth, height: layout.totalHeight }}
              />
            </div>
          </div>
        </div>

        {hovered && hoveredRowLabel && hoveredColumnLabel && hoveredValue ? (
          <div
            className="chart-tooltip heatmap-tooltip"
            style={{
              left: Math.min(tooltipMaxLeft, hovered.x + 12),
              top: Math.max(12, hovered.y + 12),
            }}
          >
            <div className="chart-tooltip-title" title={hoveredRowLabel}>
              {hoveredRowLabel}
            </div>
            <div className="chart-tooltip-copy" title={hoveredColumnLabel}>
              {hoveredColumnLabel}
            </div>
            <div className="heatmap-tooltip-sub">{hoveredValue}</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
