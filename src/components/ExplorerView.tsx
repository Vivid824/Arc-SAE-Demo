import { Legend } from './charts/Legend'
import { UmapCanvas } from './charts/UmapCanvas'
import type { EmbeddingFile, FeatureRecord } from '../lib/schema'

type ExplorerViewProps = {
  embedding: EmbeddingFile
  selectedFeature: FeatureRecord | null
}

export function ExplorerView({ embedding, selectedFeature }: ExplorerViewProps) {
  const values = selectedFeature
    ? embedding.featureActivations[selectedFeature.id]
    : undefined
  const activationRange = selectedFeature
    ? embedding.activationRanges[selectedFeature.id]
    : undefined
  const hasCells = embedding.cells.length > 0

  return (
    <div className="view-stack">
      <div className="view-intro">
        <h1 className="view-title">Explorer</h1>
        <p className="view-copy">
          UMAP of cell embeddings colored by feature activation. Each point is one cell.
        </p>
      </div>
      <div className="explorer-intro-banner">
        Sparse features extracted from Arc Institute&apos;s STATE residual stream · K562 CRISPRi · 5,120 cells · 20 perturbations · See Method for details.
      </div>
      {hasCells ? (
        <UmapCanvas
          cells={embedding.cells}
          values={values}
          activationRange={activationRange}
          featureId={selectedFeature?.id ?? null}
          isDenseFeature={Boolean(selectedFeature && selectedFeature.l0 > 90)}
        />
      ) : (
        <div className="chart-card">
          <div className="chart-card-header">
            <div>
              <h2 className="section-title">Cell embedding</h2>
              <p className="section-copy">No embedding cells available.</p>
            </div>
          </div>
        </div>
      )}
      <Legend
        mode="sequential"
        label="Activation scale"
        lowLabel="Low"
        highLabel="High"
        lowColor="#1A1F2E"
        highColor="#8B80F9"
      />
    </div>
  )
}
