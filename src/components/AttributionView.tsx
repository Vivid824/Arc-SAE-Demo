import { useMemo } from 'react'
import type { LoadedDataset } from '../lib/schema'
import { AttributionMatrix } from './charts/AttributionMatrix'
import { Legend } from './charts/Legend'

type AttributionViewProps = {
  dataset: LoadedDataset
  selectedPerturbationId: string | null
}

export function AttributionView({
  dataset,
  selectedPerturbationId,
}: AttributionViewProps) {
  const matrixData = useMemo(() => {
    if (!dataset.attribution) {
      return null
    }

    const perturbations = [
      ...new Set(dataset.attribution.attributions.map((a) => a.perturbationId)),
    ]
    const featureIds = dataset.features.map((f) => f.id).slice(0, 20) // Top 20

    // Build matrix: rows = perturbations, cols = features
    const values = perturbations.map((perturbId) =>
      featureIds.map((featureId) => {
        const attr = dataset.attribution!.attributions.find(
          (a) => a.featureId === featureId && a.perturbationId === perturbId,
        )
        return attr?.attributionScore || 0
      }),
    )

    return { perturbations, featureIds, values }
  }, [dataset])

  if (!matrixData) {
    return (
      <div className="view-stack">
        <div className="view-intro">
          <h1 className="view-title">Gradient Attribution</h1>
          <p className="view-copy">Attribution data not available</p>
        </div>
      </div>
    )
  }

  return (
    <div className="view-stack">
      <div className="view-intro">
        <h1 className="view-title">Gradient Attribution</h1>
        <p className="view-copy">
          Pseudo-gradient attribution showing which features most strongly influence each
          perturbation's prediction. Higher values indicate feature is
          disproportionately activated by the perturbation.
        </p>
      </div>

      <AttributionMatrix
        values={matrixData.values}
        rowLabels={matrixData.perturbations}
        columnLabels={matrixData.featureIds}
        selectedPerturbationId={selectedPerturbationId}
      />

      <Legend
        mode="sequential"
        label="Attribution Score"
        lowLabel="0.0 (low influence)"
        highLabel="3.0+ (high influence)"
      />

      <div className="view-note">
        <strong>Note:</strong> This is a client-side approximation computed as the ratio
        of perturbation-specific mean activation to global mean activation. True
        integrated gradients require backpropagation through the STATE model.
      </div>
    </div>
  )
}
