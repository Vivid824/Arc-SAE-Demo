import { z } from 'zod'

export const ThemeNameSchema = z.enum(['light', 'dark'])

export const ManifestSchema = z.object({
  datasetLabel: z.string(),
  datasetDoi: z.string(),
  modelLabel: z.string(),
  modelRunLabel: z.string(),
  modelUrl: z.string(),
  saeConfig: z.object({
    layer: z.number().int().nonnegative(),
    architecture: z.string(),
    expansionFactor: z.number().positive(),
    k: z.number().int().positive(),
  }),
  shortcutProbe: z.string(),
  canonicalSignatures: z.array(z.string()),
  availableLayers: z.array(z.number().int()),
  defaultLayer: z.number().int(),
  defaultFeatureId: z.string(),
  defaultPerturbation: z.string(),
  defaultTheme: ThemeNameSchema,
  filePaths: z.object({
    features: z.string(),
    embedding: z.string(),
    matrix: z.string(),
    method: z.string(),
    attribution: z.string().optional(),
  }),
})

export const GeneAssociationSchema = z.object({
  gene: z.string(),
  weight: z.number(),
})

export const PathwaySchema = z.object({
  term: z.string(),
  adjP: z.number(),
  database: z.string(),
})

export const CanonicalOverlapSchema = z.object({
  gene: z.string(),
  signatures: z.array(z.string()).min(1),
})

export const TopPerturbationSchema = z.object({
  perturbation: z.string(),
  meanActivation: z.number(),
})

export const ShortcutProbeSchema = z.object({
  probeName: z.string(),
  r2: z.number(),
  threshold: z.number(),
  status: z.enum(['pass', 'warning', 'fail']),
})

export const FeatureSchema = z.object({
  id: z.string(),
  rank: z.number().int().positive(),
  status: z.enum(['validated', 'review', 'shortcut']),
  attribution: z.number(),
  l0: z.number(),
  activeCells: z.number().int().nonnegative(),
  shortcutR2: z.number(),
  shortcutProbeDescription: z.string(),
  auditSummary: z.string(),
  geneAssociationMode: z.enum([
    'projected_hvg_decoder',
    'expression_correlation',
    'none',
  ]),
  geneAssociations: z.array(GeneAssociationSchema),
  pathways: z.array(PathwaySchema),
  canonicalOverlap: z.array(CanonicalOverlapSchema),
  topPerturbations: z.array(TopPerturbationSchema),
  perturbationMeanActivations: z.record(z.string(), z.number()),
  shortcutProbes: z.array(ShortcutProbeSchema).optional(),
  layerId: z.number().optional(),
})

export const FeaturesFileSchema = z.array(FeatureSchema)

export const EmbeddingCellSchema = z.object({
  x: z.number(),
  y: z.number(),
  perturbation: z.string(),
})

export const EmbeddingFileSchema = z.object({
  cells: z.array(EmbeddingCellSchema),
  featureActivations: z.record(z.string(), z.array(z.number())),
  activationRanges: z.record(
    z.string(),
    z.tuple([z.number(), z.number()]),
  ),
  caveat: z.string(),
})

export const MatrixFileSchema = z.object({
  perturbations: z.array(z.string()),
  featureIds: z.array(z.string()),
  values: z.array(z.array(z.number())),
  normalization: z.string(),
})

export const MethodStageSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  status: z.enum(['current', 'future']).optional(),
})

export const MethodMetricGlossaryItemSchema = z.object({
  label: z.string(),
  body: z.string(),
})

export const MethodFellowshipScopeItemSchema = z.object({
  title: z.string(),
  body: z.string(),
})

export const MethodFileSchema = z.object({
  intro: z.string().optional(),
  experimentalContextLabel: z.string().optional(),
  stages: z.array(MethodStageSchema),
  honestyCaveats: z.array(z.string()),
  metricGlossary: z.array(MethodMetricGlossaryItemSchema).optional(),
  fellowshipScope: z.array(MethodFellowshipScopeItemSchema).optional(),
  datasetProvenance: z.object({
    datasetLabel: z.string(),
    datasetDoi: z.string(),
    modelLabel: z.string().optional(),
    modelRunLabel: z.string(),
    modelUrl: z.string().optional(),
    checkpoint: z.string().optional(),
    hookSite: z.string().optional(),
    hiddenWidth: z.string().optional(),
    inferenceWindow: z.string().optional(),
    deadFeatureFraction: z.string().optional(),
    shortcutProbe: z.string().optional(),
    geneAssociations: z.string().optional(),
    pathwayDatabases: z.string().optional(),
    saeConfig: z.object({
      layer: z.number().int().nonnegative(),
      architecture: z.string(),
      expansionFactor: z.number().positive(),
      k: z.number().int().positive(),
      epochs: z.number().int().positive().optional(),
    }),
    shortcutProbeDescription: z.string(),
    geneAssociationMode: z
      .enum(['projected_hvg_decoder', 'expression_correlation', 'none'])
      .optional(),
    activationWidth: z.union([z.number().int().positive(), z.string()]).optional(),
    cellSetLen: z.union([z.number().int().positive(), z.string()]).optional(),
    exportedCells: z.union([z.number().int().positive(), z.string()]).optional(),
    exportedFeatures: z.union([z.number().int().positive(), z.string()]).optional(),
    pathwaySource: z.string().optional(),
    generatedAtUtc: z.string().optional(),
    notes: z.array(z.string()).optional(),
  }),
})

export const GradientAttributionSchema = z.object({
  featureId: z.string(),
  perturbationId: z.string(),
  attributionScore: z.number(),
  topGenes: z
    .array(
      z.object({
        gene: z.string(),
        gradientWeight: z.number(),
      }),
    )
    .max(10),
})

export const FeatureInteractionSchema = z.object({
  sourceFeatureId: z.string(),
  targetFeatureId: z.string(),
  correlation: z.number(),
  coactivationRate: z.number(),
})

export const LayerMetadataSchema = z.object({
  layer: z.number(),
  reconstructionLoss: z.number(),
  deadFeatureFraction: z.number(),
  avgL0: z.number(),
  biologicalCoherenceScore: z.number().optional(),
})

export const AttributionFileSchema = z.object({
  attributions: z.array(GradientAttributionSchema),
  interactions: z.array(FeatureInteractionSchema),
  layerMetadata: z.array(LayerMetadataSchema).optional(),
})

export type ThemeName = z.infer<typeof ThemeNameSchema>
export type Manifest = z.infer<typeof ManifestSchema>
export type FeatureRecord = z.infer<typeof FeatureSchema>
export type FeaturesFile = z.infer<typeof FeaturesFileSchema>
export type EmbeddingCell = z.infer<typeof EmbeddingCellSchema>
export type EmbeddingFile = z.infer<typeof EmbeddingFileSchema>
export type MatrixFile = z.infer<typeof MatrixFileSchema>
export type MethodFile = z.infer<typeof MethodFileSchema>
export type GradientAttribution = z.infer<typeof GradientAttributionSchema>
export type FeatureInteraction = z.infer<typeof FeatureInteractionSchema>
export type LayerMetadata = z.infer<typeof LayerMetadataSchema>
export type AttributionFile = z.infer<typeof AttributionFileSchema>
export type ShortcutProbe = z.infer<typeof ShortcutProbeSchema>

export type LoadedDataset = {
  manifest: Manifest
  features: FeaturesFile
  embedding: EmbeddingFile
  matrix: MatrixFile
  method: MethodFile
  attribution?: AttributionFile
  warnings?: string[]
  source: 'public' | 'mock'
  fallbackReason?: string
}
