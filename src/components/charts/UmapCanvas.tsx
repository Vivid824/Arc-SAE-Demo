import { useEffect, useMemo, useRef, useState } from 'react'
import { categoricalColor, createSequentialScale } from '../../lib/color'
import {
  computeBounds,
  computeCenteredFitTransform,
  findNearestPoint,
  projectCells,
} from '../../lib/umapMath'
import type { EmbeddingCell } from '../../lib/schema'

type HoverState = {
  index: number
}

type ViewportState = {
  scale: number
  panX: number
  panY: number
}

type UmapCanvasProps = {
  cells: EmbeddingCell[]
  values?: number[]
  activationRange?: [number, number]
  featureId?: string | null
  isDenseFeature?: boolean
}

const sequentialScale = createSequentialScale('#1A1F2E', '#8B80F9')
const POINT_RADIUS = 3
const POINT_ALPHA = 0.65
const HOVER_RADIUS = 5

export function UmapCanvas({
  cells,
  values,
  activationRange,
  featureId,
  isDenseFeature = false,
}: UmapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ width: 640, height: 420 })
  const [hovered, setHovered] = useState<HoverState | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [viewport, setViewport] = useState<ViewportState>({
    scale: 1,
    panX: 0,
    panY: 0,
  })
  const fitViewportRef = useRef<ViewportState>({
    scale: 1,
    panX: 0,
    panY: 0,
  })
  const viewportRef = useRef<ViewportState>({
    scale: 1,
    panX: 0,
    panY: 0,
  })
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(
    null,
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

      setSize({
        width: Math.max(320, Math.floor(entry.contentRect.width)),
        height: Math.max(260, Math.floor(entry.contentRect.height)),
      })
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const hasValueLengthMismatch =
    Boolean(values) && Array.isArray(values) && values.length !== cells.length
  const hasMissingFeatureArray = Boolean(featureId) && !values
  const safeValues =
    values?.length === cells.length
      ? values.map((value) => (Number.isFinite(value) ? value : 0))
      : undefined
  const hasAllZeroValues = safeValues?.every((value) => value === 0) ?? false
  const useFeatureColoring = Boolean(safeValues) && !hasAllZeroValues

  const points = useMemo(() => projectCells(cells), [cells])
  const fitViewport = useMemo(
    () => computeCenteredFitTransform(computeBounds(cells), size.width, size.height, 28),
    [cells, size.height, size.width],
  )

  useEffect(() => {
    setViewport(fitViewport)
  }, [fitViewport])

  useEffect(() => {
    fitViewportRef.current = fitViewport
  }, [fitViewport])

  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport])
  const toWorldCoords = (x: number, y: number) => ({
    x: (x - viewport.panX) / viewport.scale,
    y: (y - viewport.panY) / viewport.scale,
  })
  const toScreenCoords = (x: number, y: number) => ({
    x: x * viewport.scale + viewport.panX,
    y: y * viewport.scale + viewport.panY,
  })

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
    canvas.width = Math.floor(size.width * dpr)
    canvas.height = Math.floor(size.height * dpr)
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, size.width, size.height)

    const colorValues = useFeatureColoring ? safeValues ?? [] : []
    const hasStableRange =
      Boolean(activationRange) &&
      Number.isFinite(activationRange?.[0]) &&
      Number.isFinite(activationRange?.[1]) &&
      (activationRange?.[1] ?? 0) > (activationRange?.[0] ?? 0)
    const min =
      useFeatureColoring && hasStableRange
        ? (activationRange?.[0] ?? 0)
        : colorValues.length > 0
          ? Math.min(...colorValues)
          : 0
    const max =
      useFeatureColoring && hasStableRange
        ? (activationRange?.[1] ?? 1)
        : colorValues.length > 0
          ? Math.max(...colorValues)
          : 1

    points.forEach((point, index) => {
      const screenX = point.x * viewport.scale + viewport.panX
      const screenY = point.y * viewport.scale + viewport.panY
      if (
        screenX < -POINT_RADIUS ||
        screenX > size.width + POINT_RADIUS ||
        screenY < -POINT_RADIUS ||
        screenY > size.height + POINT_RADIUS
      ) {
        return
      }
      const color = useFeatureColoring
        ? (() => {
            const value = colorValues[index] ?? 0
            if (!isDenseFeature || max <= min) {
              return sequentialScale(value, min, max)
            }
            const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)))
            const floored = 0.25 + normalized * 0.75
            const adjusted = min + floored * (max - min)
            return sequentialScale(adjusted, min, max)
          })()
        : categoricalColor(cells[index]?.perturbation ?? 'unknown')

      context.beginPath()
      context.fillStyle = color
      context.globalAlpha = hovered?.index === index ? 1 : POINT_ALPHA
      context.arc(screenX, screenY, POINT_RADIUS, 0, Math.PI * 2)
      context.fill()
    })
    context.globalAlpha = 1

    if (hovered) {
      const point = points[hovered.index]
      if (point) {
        const screenX = point.x * viewport.scale + viewport.panX
        const screenY = point.y * viewport.scale + viewport.panY
        context.beginPath()
        context.lineWidth = 1.5
        context.strokeStyle = '#0D1117'
        context.arc(screenX, screenY, HOVER_RADIUS, 0, Math.PI * 2)
        context.stroke()
      }
    }
  }, [
    activationRange,
    cells,
    hovered,
    points,
    safeValues,
    size.height,
    size.width,
    useFeatureColoring,
    viewport.panX,
    viewport.panY,
    viewport.scale,
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const handleNativeWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const rect = canvas.getBoundingClientRect()
      const screenX = event.clientX - rect.left
      const screenY = event.clientY - rect.top
      if (screenX < 0 || screenY < 0 || screenX > rect.width || screenY > rect.height) {
        return
      }
      const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12

      const current = viewportRef.current
      const fit = fitViewportRef.current
      const nextScale = Math.min(
        fit.scale * 8,
        Math.max(fit.scale, current.scale * zoomFactor),
      )
      const worldX = (screenX - current.panX) / current.scale
      const worldY = (screenY - current.panY) / current.scale

      setViewport({
        scale: nextScale,
        panX: screenX - worldX * nextScale,
        panY: screenY - worldY * nextScale,
      })
    }

    // Native listeners with passive: false are required so preventDefault
    // reliably blocks browser/page zoom and scrolling.
    canvas.addEventListener('wheel', handleNativeWheel, { passive: false })

    // Safari trackpad pinch emits gesture events that can zoom the whole page.
    const preventGestureZoom = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    canvas.addEventListener('gesturestart', preventGestureZoom, { passive: false })
    canvas.addEventListener('gesturechange', preventGestureZoom, { passive: false })
    canvas.addEventListener('gestureend', preventGestureZoom, { passive: false })

    return () => {
      canvas.removeEventListener('wheel', handleNativeWheel)
      canvas.removeEventListener('gesturestart', preventGestureZoom)
      canvas.removeEventListener('gesturechange', preventGestureZoom)
      canvas.removeEventListener('gestureend', preventGestureZoom)
    }
  }, [])

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const screenX = event.clientX - rect.left
    const screenY = event.clientY - rect.top

    if (dragStartRef.current) {
      const nextPanX = dragStartRef.current.panX + (screenX - dragStartRef.current.x)
      const nextPanY = dragStartRef.current.panY + (screenY - dragStartRef.current.y)
      setViewport((current) => ({
        ...current,
        panX: nextPanX,
        panY: nextPanY,
      }))
      setHovered(null)
      return
    }

    const world = toWorldCoords(screenX, screenY)
    const winner = findNearestPoint(points, world.x, world.y, 6 / viewport.scale)

    if (!winner) {
      setHovered(null)
      return
    }

    setHovered({
      index: winner.index,
    })
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const screenX = event.clientX - rect.left
    const screenY = event.clientY - rect.top
    dragStartRef.current = {
      x: screenX,
      y: screenY,
      panX: viewport.panX,
      panY: viewport.panY,
    }
    setIsPanning(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragStartRef.current = null
    setIsPanning(false)
  }

  const handleDoubleClick = () => {
    setViewport(fitViewport)
  }

  const hoveredCell = hovered ? cells[hovered.index] : null
  const hoveredPoint = hovered ? points[hovered.index] : null
  const hoveredScreenPoint = hoveredPoint
    ? toScreenCoords(hoveredPoint.x, hoveredPoint.y)
    : null
  const hoveredValue =
    hovered && useFeatureColoring && safeValues && safeValues.length === cells.length
      ? safeValues[hovered.index]
      : null
  const minRange = activationRange?.[0]
  const maxRange = activationRange?.[1]
  const rangeSpan =
    Number.isFinite(minRange) && Number.isFinite(maxRange)
      ? (maxRange as number) - (minRange as number)
      : NaN
  const normalizedValue =
    hoveredValue !== null &&
    Number.isFinite(hoveredValue) &&
    Number.isFinite(rangeSpan) &&
    Number.isFinite(minRange)
      ? rangeSpan < 1e-6
        ? 1
        : (hoveredValue - (minRange as number)) / rangeSpan
      : null
  const rawMaxValue =
    hoveredValue !== null &&
    Number.isFinite(hoveredValue) &&
    Number.isFinite(maxRange) &&
    (maxRange as number) > 0
      ? (maxRange as number)
      : null

  return (
    <div className="chart-card">
      <div className="chart-card-header">
        <div>
          <h2 className="section-title">Cell embedding</h2>
        </div>
      </div>
      <div ref={containerRef} className="chart-stage umap-stage">
        <div className="umap-zoom-hint">Scroll to zoom · drag to pan · double-click to reset</div>
        {!featureId ? (
          <div className="chart-empty-note">
            Select a feature to color cells. Showing perturbation colors.
          </div>
        ) : null}
        {hasMissingFeatureArray ? (
          <div className="chart-empty-note">
            Missing feature activation array for {featureId}. Showing perturbation colors.
          </div>
        ) : null}
        {hasValueLengthMismatch ? (
          <div className="chart-empty-note">
            Activation array length does not match embedding cell count. Showing perturbation colors.
          </div>
        ) : null}
        {!hasValueLengthMismatch && hasAllZeroValues ? (
          <div className="chart-empty-note">
            All activation values are zero for this feature. Showing perturbation colors.
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          className="chart-canvas umap-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={(event) => {
            setHovered(null)
            handlePointerUp(event)
          }}
          onDoubleClick={handleDoubleClick}
          style={{ touchAction: 'none', cursor: isPanning ? 'grabbing' : 'crosshair' }}
        />
        {hovered && hoveredCell && hoveredScreenPoint ? (
          <div
            className="chart-tooltip"
            style={{
              left: Math.min(size.width - 180, hoveredScreenPoint.x + 12),
              top: Math.max(12, hoveredScreenPoint.y + 12),
            }}
          >
            {featureId ? <div className="chart-tooltip-title">{featureId}</div> : null}
            <div className="chart-tooltip-copy">Perturbation: {hoveredCell.perturbation}</div>
            {hoveredValue !== null && normalizedValue !== null ? (
              <div className="chart-tooltip-copy">
                Activation: {Math.max(0, Math.min(1, normalizedValue)).toFixed(2)}
              </div>
            ) : hoveredValue !== null ? (
              <div className="chart-tooltip-copy">
                Activation: {Math.round(hoveredValue)}
              </div>
            ) : null}
            {hoveredValue !== null && rawMaxValue !== null ? (
              <div className="chart-tooltip-copy">
                Raw: {Math.round(hoveredValue)} / {Math.round(rawMaxValue)} max
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="section-copy umap-caption">
        Each point = one cell · Color = feature activation strength
      </p>
    </div>
  )
}
