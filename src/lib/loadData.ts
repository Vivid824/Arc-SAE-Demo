import {
  EmbeddingFileSchema,
  FeaturesFileSchema,
  ManifestSchema,
  MatrixFileSchema,
  MethodFileSchema,
  type LoadedDataset,
} from './schema'

export type DataLoadErrorKind = 'network' | 'http' | 'parse' | 'schema'

export class DataLoadError extends Error {
  kind: DataLoadErrorKind
  url: string
  status?: number
  details?: string

  constructor(
    kind: DataLoadErrorKind,
    message: string,
    url: string,
    options?: { status?: number; details?: string },
  ) {
    super(message)
    this.name = 'DataLoadError'
    this.kind = kind
    this.url = url
    this.status = options?.status
    this.details = options?.details
  }
}

export function describeDataLoadError(error: DataLoadError): string {
  const parts = [
    `kind=${error.kind}`,
    `url=${error.url}`,
  ]

  if (typeof error.status === 'number') {
    parts.push(`status=${error.status}`)
  }
  if (error.details) {
    parts.push(`details=${error.details}`)
  }

  return parts.join(' | ')
}

async function fetchJson<T>(
  url: string,
  schema: { parse: (value: unknown) => T },
  signal?: AbortSignal,
): Promise<T> {
  let response: Response

  try {
    response = await fetch(url, { signal })
  } catch (error) {
    throw new DataLoadError(
      'network',
      'Unable to reach the requested JSON file.',
      url,
      { details: error instanceof Error ? error.message : String(error) },
    )
  }

  if (!response.ok) {
    throw new DataLoadError(
      'http',
      'The requested JSON file could not be loaded.',
      url,
      { status: response.status, details: response.statusText },
    )
  }

  let parsed: unknown
  try {
    parsed = await response.json()
  } catch (error) {
    throw new DataLoadError(
      'parse',
      'The JSON file was fetched but could not be parsed.',
      url,
      { details: error instanceof Error ? error.message : String(error) },
    )
  }

  try {
    return schema.parse(parsed)
  } catch (error) {
    throw new DataLoadError(
      'schema',
      'The JSON file does not match the expected schema.',
      url,
      { details: error instanceof Error ? error.message : String(error) },
    )
  }
}

export function derivePerturbations(dataset: Omit<LoadedDataset, 'source' | 'fallbackReason'>) {
  const featurePerturbations = dataset.features.flatMap((feature) =>
    Object.keys(feature.perturbationMeanActivations),
  )
  const embeddingPerturbations = dataset.embedding.cells.map((cell) => cell.perturbation)

  return [...new Set([...featurePerturbations, ...embeddingPerturbations])]
}

export async function loadManifest(signal?: AbortSignal) {
  return fetchJson('/data/manifest.json', ManifestSchema, signal)
}

export async function loadDatasetFiles(
  dataset: Pick<LoadedDataset, 'manifest'>,
  signal?: AbortSignal,
) {
  const { filePaths } = dataset.manifest

  const [features, embedding, matrix, method] = await Promise.all([
    fetchJson(filePaths.features, FeaturesFileSchema, signal),
    fetchJson(filePaths.embedding, EmbeddingFileSchema, signal),
    fetchJson(filePaths.matrix, MatrixFileSchema, signal),
    fetchJson(filePaths.method, MethodFileSchema, signal),
  ])

  return { features, embedding, matrix, method }
}

export async function loadAppData(signal?: AbortSignal): Promise<LoadedDataset> {
  const manifest = await loadManifest(signal)
  const dataset = await loadDatasetFiles({ manifest }, signal)
  const warnings: string[] = []
  const featureIds = new Set(dataset.features.map((feature) => feature.id))

  if (!featureIds.has(manifest.defaultFeatureId)) {
    warnings.push(
      `manifest.defaultFeatureId (${manifest.defaultFeatureId}) is not present in features.json; app will fall back to first sorted feature.`,
    )
  }

  const embeddingPerturbations = new Set(
    dataset.embedding.cells.map((cell) => cell.perturbation),
  )
  const pmaPerturbations = new Set(
    dataset.features.flatMap((feature) =>
      Object.keys(feature.perturbationMeanActivations),
    ),
  )
  const embeddingOnly = [...embeddingPerturbations].filter(
    (label) => !pmaPerturbations.has(label),
  )
  const pmaOnly = [...pmaPerturbations].filter(
    (label) => !embeddingPerturbations.has(label),
  )
  if (embeddingOnly.length > 0 || pmaOnly.length > 0) {
    warnings.push(
      [
        'Perturbation label mismatch between embedding cells and PMA maps.',
        embeddingOnly.length > 0
          ? `in embedding only: ${embeddingOnly.slice(0, 8).join(', ')}`
          : '',
        pmaOnly.length > 0
          ? `in PMA only: ${pmaOnly.slice(0, 8).join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }

  const cellCount = dataset.embedding.cells.length
  const missingFeatureActivationIds: string[] = []
  const lengthMismatchSummaries: string[] = []
  let allZeroActivationCount = 0

  for (const feature of dataset.features) {
    const acts = dataset.embedding.featureActivations[feature.id]
    if (!acts) {
      missingFeatureActivationIds.push(feature.id)
      continue
    }

    if (acts.length !== cellCount) {
      lengthMismatchSummaries.push(
        `${feature.id} (${acts.length}/${cellCount})`,
      )
    }

    const hasNonZero = acts.some((value) => Number.isFinite(value) && value !== 0)
    if (!hasNonZero) {
      allZeroActivationCount += 1
    }
  }

  if (missingFeatureActivationIds.length > 0) {
    warnings.push(
      `Missing embedding.featureActivations entries for ${missingFeatureActivationIds.length} features (examples: ${missingFeatureActivationIds.slice(0, 8).join(', ')}).`,
    )
  }
  if (lengthMismatchSummaries.length > 0) {
    warnings.push(
      `Activation length mismatch for ${lengthMismatchSummaries.length} features (examples: ${lengthMismatchSummaries.slice(0, 6).join(', ')}).`,
    )
  }
  if (allZeroActivationCount > 0) {
    warnings.push(
      `All-zero activation arrays detected for ${allZeroActivationCount} features; UMAP coloring will fall back to perturbation colors for those features.`,
    )
  }

  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.warn(`[data-preflight] ${warning}`)
    }
  }

  return {
    manifest,
    ...dataset,
    warnings,
    source: 'public',
  }
}
