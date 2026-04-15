import type {
  FeatureRecord,
  EmbeddingFile,
  GradientAttribution,
  FeatureInteraction,
  ShortcutProbe,
} from './schema'

/**
 * Compute pseudo-gradient attribution as perturbation-specific feature importance.
 *
 * Proxy metric: For each perturbation P and feature F:
 *   attribution(F, P) = meanActivation(F in cells with P) / meanActivation(F in all cells)
 *
 * Higher values = feature is disproportionately activated by this perturbation.
 */
export function computePseudoGradients(
  features: FeatureRecord[],
  embedding: EmbeddingFile,
): GradientAttribution[] {
  const attributions: GradientAttribution[] = []

  // Safety check
  if (!embedding || !embedding.cells || !embedding.featureActivations) {
    return attributions
  }

  const perturbations = [...new Set(embedding.cells.map((c) => c.perturbation))]

  for (const feature of features) {
    const activations = embedding.featureActivations[feature.id]
    if (!activations || activations.length === 0) {
      continue
    }

    const globalMean = activations.reduce((sum, v) => sum + v, 0) / activations.length

    for (const perturbation of perturbations) {
      const perturbCells = embedding.cells
        .map((cell, idx) => ({ cell, idx }))
        .filter(({ cell }) => cell.perturbation === perturbation)

      if (perturbCells.length === 0) {
        continue
      }

      const perturbMean =
        perturbCells.reduce((sum, { idx }) => sum + activations[idx], 0) /
        perturbCells.length

      const attributionScore = globalMean > 0 ? perturbMean / globalMean : 0

      // Top genes already in feature.geneAssociations, take top 5
      const topGenes = feature.geneAssociations.slice(0, 5).map((assoc) => ({
        gene: assoc.gene,
        gradientWeight: assoc.weight * attributionScore, // Scale by attribution
      }))

      attributions.push({
        featureId: feature.id,
        perturbationId: perturbation,
        attributionScore,
        topGenes,
      })
    }
  }

  return attributions
}

/**
 * Compute pairwise feature correlations across cells.
 *
 * Uses Spearman rank correlation between feature activation vectors.
 */
export function computeFeatureInteractions(
  features: FeatureRecord[],
  embedding: EmbeddingFile,
  minCorrelation: number = 0.3,
): FeatureInteraction[] {
  const interactions: FeatureInteraction[] = []

  // Safety check
  if (!embedding || !embedding.featureActivations) {
    return interactions
  }

  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const sourceId = features[i].id
      const targetId = features[j].id

      const sourceActivations = embedding.featureActivations[sourceId]
      const targetActivations = embedding.featureActivations[targetId]

      if (!sourceActivations || !targetActivations) {
        continue
      }

      const correlation = spearmanCorrelation(sourceActivations, targetActivations)

      if (Math.abs(correlation) < minCorrelation) {
        continue
      }

      const coactivationRate =
        sourceActivations
          .map((v, idx) => (v > 0 && targetActivations[idx] > 0 ? 1 : 0))
          .reduce((sum: number, v: number) => sum + v, 0) / sourceActivations.length

      interactions.push({
        sourceFeatureId: sourceId,
        targetFeatureId: targetId,
        correlation,
        coactivationRate,
      })
    }
  }

  return interactions
}

/**
 * Spearman rank correlation
 */
function spearmanCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) {
    return 0
  }

  const n = x.length
  const rankX = rankArray(x)
  const rankY = rankArray(y)

  const meanRankX = rankX.reduce((sum, v) => sum + v, 0) / n
  const meanRankY = rankY.reduce((sum, v) => sum + v, 0) / n

  let numerator = 0
  let denomX = 0
  let denomY = 0

  for (let i = 0; i < n; i++) {
    const dx = rankX[i] - meanRankX
    const dy = rankY[i] - meanRankY
    numerator += dx * dy
    denomX += dx * dx
    denomY += dy * dy
  }

  if (denomX === 0 || denomY === 0) {
    return 0
  }

  return numerator / Math.sqrt(denomX * denomY)
}

function rankArray(arr: number[]): number[] {
  const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const ranks = new Array(arr.length)
  for (let i = 0; i < sorted.length; i++) {
    ranks[sorted[i].i] = i + 1
  }
  return ranks
}

/**
 * Compute extended shortcut probes from existing data.
 *
 * Derive proxies for technical confounders:
 * - Library size (already exists as shortcutR2)
 * - Perturbation batch (variance explained by perturbation grouping)
 * - Cell cycle phase (correlation with cell cycle genes)
 */
export function computeExtendedShortcuts(
  feature: FeatureRecord,
  embedding: EmbeddingFile,
): ShortcutProbe[] {
  const probes: ShortcutProbe[] = []

  // 1. Library size (from existing data)
  probes.push({
    probeName: 'Library size',
    r2: feature.shortcutR2,
    threshold: 0.35,
    status:
      feature.shortcutR2 < 0.35 ? 'pass' : feature.shortcutR2 < 0.55 ? 'warning' : 'fail',
  })

  // Safety check: ensure embedding data exists
  if (!embedding || !embedding.featureActivations || !embedding.cells) {
    return probes
  }

  // 2. Perturbation batch proxy (variance explained by perturbation grouping)
  const activations = embedding.featureActivations[feature.id] || []
  if (activations.length === 0) {
    return probes
  }

  const perturbationGroups: Record<string, number[]> = {}

  embedding.cells.forEach((cell, idx) => {
    if (!perturbationGroups[cell.perturbation]) {
      perturbationGroups[cell.perturbation] = []
    }
    perturbationGroups[cell.perturbation].push(activations[idx] || 0)
  })

  const betweenGroupVariance = computeBetweenGroupVariance(
    perturbationGroups,
    activations,
  )
  const totalVariance = computeVariance(activations)
  const batchR2 = totalVariance > 0 ? betweenGroupVariance / totalVariance : 0

  probes.push({
    probeName: 'Perturbation signal',
    r2: batchR2,
    threshold: 0.7, // High threshold: feature SHOULD vary by perturbation
    status: batchR2 > 0.7 ? 'pass' : batchR2 > 0.4 ? 'warning' : 'fail',
  })

  // 3. Cell cycle proxy (if we have cell cycle genes in associations)
  const cellCycleGenes = [
    'CCND1',
    'MKI67',
    'CDK4',
    'CDK6',
    'E2F1',
    'MCM2',
    'PCNA',
    'TOP2A',
    'AURKB',
  ]
  const cellCycleWeights = feature.geneAssociations
    .filter((assoc) => cellCycleGenes.includes(assoc.gene))
    .map((assoc) => Math.abs(assoc.weight))

  const cellCycleR2 = cellCycleWeights.length > 0 ? Math.max(...cellCycleWeights) : 0

  probes.push({
    probeName: 'Cell cycle',
    r2: cellCycleR2,
    threshold: 0.6,
    status: cellCycleR2 < 0.6 ? 'pass' : cellCycleR2 < 0.75 ? 'warning' : 'fail',
  })

  return probes
}

function computeVariance(values: number[]): number {
  if (values.length === 0) {
    return 0
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
}

function computeBetweenGroupVariance(
  groups: Record<string, number[]>,
  allValues: number[],
): number {
  if (allValues.length === 0) {
    return 0
  }

  const grandMean = allValues.reduce((sum, v) => sum + v, 0) / allValues.length

  let betweenVariance = 0
  for (const groupValues of Object.values(groups)) {
    if (groupValues.length === 0) {
      continue
    }
    const groupMean = groupValues.reduce((sum, v) => sum + v, 0) / groupValues.length
    betweenVariance += groupValues.length * (groupMean - grandMean) ** 2
  }

  return betweenVariance / allValues.length
}
