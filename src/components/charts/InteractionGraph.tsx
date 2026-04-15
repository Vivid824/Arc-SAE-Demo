import { useEffect, useRef, useState } from 'react'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force'
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force'

type GraphNode = SimulationNodeDatum & {
  id: string
  label: string
  size: number
  status: 'validated' | 'review' | 'shortcut'
}

type GraphEdge = SimulationLinkDatum<GraphNode> & {
  weight: number
  coactivation: number
}

type InteractionGraphProps = {
  nodes: Array<{ id: string; label: string; size: number; status: string }>
  edges: Array<{
    source: string
    target: string
    weight: number
    coactivation: number
  }>
  selectedNodeId: string | null
  onSelectNode: (id: string) => void
}

type HoverState = {
  type: 'node' | 'edge'
  data: GraphNode | GraphEdge
  x: number
  y: number
}

const STATUS_COLORS = {
  validated: '#1D9E75',
  review: '#BA7517',
  shortcut: '#D85A30',
}

export function InteractionGraph({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
}: InteractionGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [hovered, setHovered] = useState<HoverState | null>(null)
  const simulationRef = useRef<ReturnType<typeof forceSimulation<GraphNode, GraphEdge>> | null>(
    null,
  )
  const graphDataRef = useRef<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  })
  const [, forceUpdate] = useState(0)

  // Initialize simulation
  useEffect(() => {
    if (nodes.length === 0) {
      return
    }

    // Convert to simulation nodes/links
    const graphNodes: GraphNode[] = nodes.map((n) => ({
      id: n.id,
      label: n.label,
      size: Math.max(10, n.size * 20), // Scale for visibility
      status: n.status as 'validated' | 'review' | 'shortcut',
    }))

    const graphEdges: GraphEdge[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      coactivation: e.coactivation,
    }))

    graphDataRef.current = { nodes: graphNodes, edges: graphEdges }

    const simulation = forceSimulation<GraphNode, GraphEdge>(graphNodes)
      .force(
        'link',
        forceLink<GraphNode, GraphEdge>(graphEdges)
          .id((d) => d.id)
          .distance(80),
      )
      .force('charge', forceManyBody().strength(-300))
      .force('center', forceCenter(size.width / 2, size.height / 2))
      .force('collide', forceCollide().radius((d) => (d as GraphNode).size + 5))
      .on('tick', () => {
        forceUpdate((n) => n + 1)
      })

    simulationRef.current = simulation

    return () => {
      simulation.stop()
    }
  }, [nodes, edges, size.width, size.height])

  // Resize observer
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
        width: Math.max(400, Math.floor(entry.contentRect.width)),
        height: Math.min(600, Math.max(400, Math.floor(entry.contentRect.height))),
      })
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Render canvas
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

    const { nodes: graphNodes, edges: graphEdges } = graphDataRef.current

    // Draw edges
    graphEdges.forEach((edge) => {
      const source = edge.source as GraphNode
      const target = edge.target as GraphNode

      if (!source.x || !source.y || !target.x || !target.y) {
        return
      }

      const isHovered = hovered?.type === 'edge' && hovered.data === edge
      const isConnectedToSelected =
        selectedNodeId &&
        (source.id === selectedNodeId || target.id === selectedNodeId)

      context.beginPath()
      context.moveTo(source.x, source.y)
      context.lineTo(target.x, target.y)
      context.strokeStyle =
        edge.weight >= 0
          ? isConnectedToSelected || isHovered
            ? '#3B82F6'
            : 'rgba(59, 130, 246, 0.3)'
          : isConnectedToSelected || isHovered
            ? '#D85A30'
            : 'rgba(216, 90, 48, 0.3)'
      context.lineWidth = isHovered ? 3 : Math.abs(edge.weight) * 2 + 1
      context.stroke()
    })

    // Draw nodes
    graphNodes.forEach((node) => {
      if (!node.x || !node.y) {
        return
      }

      const isSelected = node.id === selectedNodeId
      const isHovered = hovered?.type === 'node' && (hovered.data as GraphNode).id === node.id
      const radius = node.size / 2

      context.beginPath()
      context.arc(node.x, node.y, radius, 0, 2 * Math.PI)
      context.fillStyle = STATUS_COLORS[node.status] || '#534AB7'
      context.globalAlpha = isSelected || isHovered ? 1 : 0.8
      context.fill()
      context.globalAlpha = 1

      if (isSelected || isHovered) {
        context.strokeStyle = isSelected ? '#0D1117' : '#534AB7'
        context.lineWidth = isSelected ? 3 : 2
        context.stroke()
      }

      // Label
      if (isSelected || isHovered) {
        context.fillStyle = '#0D1117'
        context.font = '11px Inter, system-ui, sans-serif'
        context.textAlign = 'center'
        context.fillText(node.label, node.x, node.y + radius + 14)
      }
    })
  }, [size, hovered, selectedNodeId])

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const containerRect = containerRef.current?.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    const { nodes: graphNodes, edges: graphEdges } = graphDataRef.current

    // Check node hits
    for (const node of graphNodes) {
      if (!node.x || !node.y) {
        continue
      }

      const dx = x - node.x
      const dy = y - node.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      if (distance <= node.size / 2) {
        if (containerRect) {
          setHovered({
            type: 'node',
            data: node,
            x: event.clientX - containerRect.left,
            y: event.clientY - containerRect.top,
          })
        }
        return
      }
    }

    // Check edge hits (wider hit area)
    for (const edge of graphEdges) {
      const source = edge.source as GraphNode
      const target = edge.target as GraphNode

      if (!source.x || !source.y || !target.x || !target.y) {
        continue
      }

      const distance = pointToLineDistance(x, y, source.x, source.y, target.x, target.y)

      if (distance < 5) {
        if (containerRect) {
          setHovered({
            type: 'edge',
            data: edge,
            x: event.clientX - containerRect.left,
            y: event.clientY - containerRect.top,
          })
        }
        return
      }
    }

    setHovered(null)
  }

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    const { nodes: graphNodes } = graphDataRef.current

    for (const node of graphNodes) {
      if (!node.x || !node.y) {
        continue
      }

      const dx = x - node.x
      const dy = y - node.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      if (distance <= node.size / 2) {
        onSelectNode(node.id)
        return
      }
    }
  }

  const handleDragStart = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    const { nodes: graphNodes } = graphDataRef.current

    for (const node of graphNodes) {
      if (!node.x || !node.y) {
        continue
      }

      const dx = x - node.x
      const dy = y - node.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      if (distance <= node.size / 2) {
        node.fx = node.x
        node.fy = node.y
        simulationRef.current?.alphaTarget(0.3).restart()

        const handleDrag = (dragEvent: PointerEvent) => {
          const dragRect = event.currentTarget.getBoundingClientRect()
          node.fx = dragEvent.clientX - dragRect.left
          node.fy = dragEvent.clientY - dragRect.top
        }

        const handleDragEnd = () => {
          node.fx = null
          node.fy = null
          simulationRef.current?.alphaTarget(0)
          document.removeEventListener('pointermove', handleDrag)
          document.removeEventListener('pointerup', handleDragEnd)
        }

        document.addEventListener('pointermove', handleDrag)
        document.addEventListener('pointerup', handleDragEnd)
        return
      }
    }
  }

  return (
    <div className="chart-card" ref={containerRef}>
      <canvas
        ref={canvasRef}
        width={size.width}
        height={size.height}
        style={{
          width: `${size.width}px`,
          height: `${size.height}px`,
          cursor: hovered ? 'pointer' : 'default',
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHovered(null)}
        onClick={handleClick}
        onPointerDown={handleDragStart}
      />
      {hovered && (
        <div
          className="chart-tooltip"
          style={{
            position: 'absolute',
            left: `${hovered.x + 12}px`,
            top: `${hovered.y + 12}px`,
            pointerEvents: 'none',
          }}
        >
          {hovered.type === 'node' ? (
            <div>
              <strong>{(hovered.data as GraphNode).label}</strong>
              <div>Status: {(hovered.data as GraphNode).status}</div>
            </div>
          ) : (
            <div>
              <div>
                <strong>
                  {((hovered.data as GraphEdge).source as GraphNode).id} ↔{' '}
                  {((hovered.data as GraphEdge).target as GraphNode).id}
                </strong>
              </div>
              <div>Correlation: {(hovered.data as GraphEdge).weight.toFixed(3)}</div>
              <div>
                Co-activation: {((hovered.data as GraphEdge).coactivation * 100).toFixed(1)}
                %
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function pointToLineDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
  }

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared))
  const projX = x1 + t * dx
  const projY = y1 + t * dy

  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
}
