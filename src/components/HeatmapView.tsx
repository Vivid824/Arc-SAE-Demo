import { Legend } from './charts/Legend'
import { HeatmapMatrix } from './charts/HeatmapMatrix'
import type { MatrixFile } from '../lib/schema'

type HeatmapViewProps = {
  matrix: MatrixFile
  selectedPerturbationId: string | null
}

export function HeatmapView({ matrix, selectedPerturbationId }: HeatmapViewProps) {
  const maxColumns = Math.min(
    20,
    matrix.featureIds.length,
    ...matrix.values.map((row) => row.length),
  )
  const featureIds = matrix.featureIds.slice(0, maxColumns)
  const values = matrix.values.map((row) => row.slice(0, maxColumns))

  const hasHeatmapData =
    matrix.perturbations.length > 0 && featureIds.length > 0 && values.length > 0

  return (
    <div className="view-stack">
      <div className="view-intro">
        <h1 className="view-title">Heatmap</h1>
        <p className="view-copy">
          Perturbation-by-feature overview using normalized display values. List
          ranking still comes from raw per-perturbation means.
        </p>
      </div>
      {hasHeatmapData ? (
        <HeatmapMatrix
          values={values}
          rowLabels={matrix.perturbations}
          columnLabels={featureIds}
          selectedPerturbationId={selectedPerturbationId}
        />
      ) : (
        <div className="chart-card">
          <div className="chart-card-header">
            <div>
              <h2 className="section-title">Feature x perturbation heatmap</h2>
              <p className="section-copy">No matrix data available for this selection.</p>
            </div>
          </div>
        </div>
      )}
      <Legend
        mode="sequential"
        label={matrix.normalization || 'Normalized display scale'}
        lowLabel="Low"
        highLabel="High"
      />
    </div>
  )
}
