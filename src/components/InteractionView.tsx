import { useMemo, useState } from 'react'
import type { LoadedDataset } from '../lib/schema'
import { InteractionGraph } from './charts/InteractionGraph'

type InteractionViewProps = {
  dataset: LoadedDataset
  selectedFeatureId: string | null
  onSelectFeature: (id: string) => void
}

export function InteractionView({
  dataset,
  selectedFeatureId,
  onSelectFeature,
}: InteractionViewProps) {
  const [correlationThreshold, setCorrelationThreshold] = useState(0.3)
  const [maxEdges, setMaxEdges] = useState(50)

  const graphData = useMemo(() => {
    if (!dataset.attribution) {
      return { nodes: [], edges: [] }
    }

    const nodes = dataset.features.slice(0, 20).map((f) => ({
      id: f.id,
      label: f.id,
      size: f.attribution / 100, // Scale by attribution
      status: f.status,
    }))

    // Create a set of valid node IDs to filter edges
    const nodeIds = new Set(nodes.map((n) => n.id))

    const edges = dataset.attribution.interactions
      .filter((i) => Math.abs(i.correlation) >= correlationThreshold)
      // Only include edges where both source and target are in the nodes list
      .filter((i) => nodeIds.has(i.sourceFeatureId) && nodeIds.has(i.targetFeatureId))
      .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
      .slice(0, maxEdges)
      .map((i) => ({
        source: i.sourceFeatureId,
        target: i.targetFeatureId,
        weight: i.correlation,
        coactivation: i.coactivationRate,
      }))

    return { nodes, edges }
  }, [dataset, correlationThreshold, maxEdges])

  if (!dataset.attribution) {
    return (
      <div className="view-stack">
        <div className="view-intro">
          <h1 className="view-title">Feature Interactions</h1>
          <p className="view-copy">Interaction data not available</p>
        </div>
      </div>
    )
  }

  return (
    <div className="view-stack">
      <div className="view-intro">
        <h1 className="view-title">Feature Interactions</h1>
        <p className="view-copy">
          Network graph of feature co-activation patterns. Edges represent Spearman
          correlation between feature activation vectors across cells. Blue edges indicate
          positive correlation, orange edges indicate negative correlation.
        </p>
        <div className="view-controls" style={{ display: 'flex', gap: '24px', marginTop: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>Min correlation:</span>
            <input
              type="range"
              min="0.1"
              max="0.9"
              step="0.1"
              value={correlationThreshold}
              onChange={(e) => setCorrelationThreshold(Number(e.target.value))}
              style={{ width: '120px' }}
            />
            <span style={{ minWidth: '32px', textAlign: 'right' }}>
              {correlationThreshold.toFixed(1)}
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>Max edges:</span>
            <input
              type="range"
              min="10"
              max="100"
              step="10"
              value={maxEdges}
              onChange={(e) => setMaxEdges(Number(e.target.value))}
              style={{ width: '120px' }}
            />
            <span style={{ minWidth: '32px', textAlign: 'right' }}>{maxEdges}</span>
          </label>
        </div>
      </div>

      <InteractionGraph
        nodes={graphData.nodes}
        edges={graphData.edges}
        selectedNodeId={selectedFeatureId}
        onSelectNode={onSelectFeature}
      />

      <div className="view-note">
        <strong>Interaction Legend:</strong>
        <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
          <li>
            <span style={{ color: '#1D9E75', fontWeight: 'bold' }}>Green</span>: Validated
            features
          </li>
          <li>
            <span style={{ color: '#BA7517', fontWeight: 'bold' }}>Orange</span>: Features
            under review
          </li>
          <li>
            <span style={{ color: '#D85A30', fontWeight: 'bold' }}>Red</span>: Shortcut
            features
          </li>
          <li>
            <span style={{ color: '#3B82F6', fontWeight: 'bold' }}>Blue edges</span>:
            Positive correlation
          </li>
          <li>
            <span style={{ color: '#D85A30', fontWeight: 'bold' }}>Orange edges</span>:
            Negative correlation
          </li>
        </ul>
        <p style={{ marginTop: '8px' }}>
          <strong>Interaction:</strong> Click a node to select that feature. Drag nodes to
          reposition them.
        </p>
      </div>
    </div>
  )
}
