import type { FeatureRecord } from './schema'

export function getPerturbationActivation(
  feature: FeatureRecord,
  perturbationId: string | null,
): number | null {
  if (!perturbationId) {
    return null
  }

  const value = feature.perturbationMeanActivations[perturbationId]
  return value ?? null
}

export function sortFeatures(
  features: FeatureRecord[],
  selectedPerturbationId: string | null,
): FeatureRecord[] {
  return [...features].sort((left, right) => {
    const leftPerturbation = getPerturbationActivation(left, selectedPerturbationId)
    const rightPerturbation = getPerturbationActivation(right, selectedPerturbationId)

    if (selectedPerturbationId) {
      const leftScore = leftPerturbation ?? Number.NEGATIVE_INFINITY
      const rightScore = rightPerturbation ?? Number.NEGATIVE_INFINITY

      if (leftScore !== rightScore) {
        return rightScore - leftScore
      }
    }

    if (left.attribution !== right.attribution) {
      return right.attribution - left.attribution
    }

    return left.id.localeCompare(right.id)
  })
}

export function filterFeatures(features: FeatureRecord[], query: string): FeatureRecord[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) {
    return features
  }

  return features.filter((feature) => {
    if (feature.id.toLowerCase().includes(trimmed)) {
      return true
    }

    if (feature.geneAssociations.some(({ gene }) => gene.toLowerCase().includes(trimmed))) {
      return true
    }

    return feature.pathways.some(({ term }) => term.toLowerCase().includes(trimmed))
  })
}

