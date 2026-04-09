import type {
  EmbeddingCell,
  EmbeddingFile,
  FeaturesFile,
  Manifest,
  MatrixFile,
  MethodFile,
} from '../lib/schema'

const perturbations = ['non-targeting', 'MYC', 'CCND1', 'PTPN11']

function makeCells(
  perturbation: string,
  centerX: number,
  centerY: number,
  count: number,
): EmbeddingCell[] {
  return Array.from({ length: count }, (_, index) => {
    const col = index % 3
    const row = Math.floor(index / 3)

    return {
      perturbation,
      x: centerX + (col - 1) * 0.26 + row * 0.05,
      y: centerY + ((index % 2) - 0.5) * 0.34 + row * 0.04,
    }
  })
}

const cells = [
  ...makeCells('non-targeting', -2.1, -1.3, 6),
  ...makeCells('MYC', 1.4, 1.1, 6),
  ...makeCells('CCND1', 2.1, -0.9, 6),
  ...makeCells('PTPN11', -1.0, 1.9, 6),
]

function baseActivation(perturbation: string, index: number, profile: Record<string, number>) {
  const offset = (index % 3) * 0.06 + Math.floor(index / 3) * 0.03
  return Number((profile[perturbation] + offset).toFixed(3))
}

const featureActivations: Record<string, number[]> = {
  F0000: cells.map((cell, index) =>
    baseActivation(cell.perturbation, index, {
      'non-targeting': 0.12,
      MYC: 1.18,
      CCND1: 0.84,
      PTPN11: 0.24,
    }),
  ),
  F0001: cells.map((cell, index) =>
    baseActivation(cell.perturbation, index, {
      'non-targeting': 0.08,
      MYC: 0.22,
      CCND1: 0.31,
      PTPN11: 1.12,
    }),
  ),
  F0002: cells.map((cell, index) =>
    baseActivation(cell.perturbation, index, {
      'non-targeting': 0.36,
      MYC: 0.64,
      CCND1: 0.71,
      PTPN11: 0.59,
    }),
  ),
  F0003: cells.map((cell, index) =>
    baseActivation(cell.perturbation, index, {
      'non-targeting': 0.1,
      MYC: 0.14,
      CCND1: 1.02,
      PTPN11: 0.19,
    }),
  ),
  F0004: cells.map((cell, index) =>
    baseActivation(cell.perturbation, index, {
      'non-targeting': 0.09,
      MYC: 0.18,
      CCND1: 0.24,
      PTPN11: 0.78,
    }),
  ),
  F0005: cells.map((cell, index) =>
    baseActivation(cell.perturbation, index, {
      'non-targeting': 0.05,
      MYC: 0.42,
      CCND1: 0.28,
      PTPN11: 0.16,
    }),
  ),
}

function mean(values: number[]) {
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4))
}

function countActive(values: number[]) {
  return values.filter((value) => value > 0.15).length
}

function l0(values: number[]) {
  return Number((((values.filter((value) => value > 0).length / values.length) * 100)).toFixed(2))
}

function perturbationMeans(values: number[]) {
  return Object.fromEntries(
    perturbations.map((perturbation) => {
      const selected = values.filter((_, index) => cells[index]?.perturbation === perturbation)
      return [perturbation, mean(selected)]
    }),
  )
}

const featureMetadata = [
  {
    id: 'F0000',
    status: 'validated' as const,
    shortcutR2: 0.18,
    shortcutProbeDescription: 'Library size proxy fallback in MVP',
    auditSummary: 'Low correlation to the library-size proxy; retained for biological review.',
    geneAssociationMode: 'expression_correlation' as const,
    geneAssociations: [
      { gene: 'MYC', weight: 0.82 },
      { gene: 'CDK4', weight: 0.73 },
      { gene: 'E2F1', weight: 0.67 },
      { gene: 'RRM2', weight: 0.41 },
    ],
    pathways: [
      { term: 'HALLMARK_MYC_TARGETS_V1', adjP: 0.0021, database: 'Hallmark' },
    ],
    canonicalOverlap: [
      { gene: 'MYC', signatures: ['myc_targets', 'bcr_abl'] },
      { gene: 'CDK4', signatures: ['myc_targets'] },
    ],
  },
  {
    id: 'F0001',
    status: 'validated' as const,
    shortcutR2: 0.12,
    shortcutProbeDescription: 'Library size proxy fallback in MVP',
    auditSummary: 'Specific to the PTPN11/STAT5-like branch with little technical coupling.',
    geneAssociationMode: 'expression_correlation' as const,
    geneAssociations: [
      { gene: 'STAT5A', weight: 0.79 },
      { gene: 'CRKL', weight: 0.7 },
      { gene: 'BCL2', weight: 0.58 },
      { gene: 'PTPN11', weight: 0.54 },
    ],
    pathways: [
      { term: 'KEGG_CHRONIC_MYELOID_LEUKEMIA', adjP: 0.0134, database: 'KEGG' },
    ],
    canonicalOverlap: [
      { gene: 'STAT5A', signatures: ['bcr_abl'] },
      { gene: 'BCL2', signatures: ['bcr_abl'] },
    ],
  },
  {
    id: 'F0002',
    status: 'review' as const,
    shortcutR2: 0.41,
    shortcutProbeDescription: 'Library size proxy fallback in MVP',
    auditSummary: 'Moderate coupling to the library-size proxy; flagged for review.',
    geneAssociationMode: 'expression_correlation' as const,
    geneAssociations: [
      { gene: 'MKI67', weight: 0.48 },
      { gene: 'PCNA', weight: 0.46 },
      { gene: 'TOP2A', weight: 0.43 },
    ],
    pathways: [],
    canonicalOverlap: [],
  },
  {
    id: 'F0003',
    status: 'validated' as const,
    shortcutR2: 0.14,
    shortcutProbeDescription: 'Library size proxy fallback in MVP',
    auditSummary: 'CCND1-linked cell-cycle feature with minimal shortcut signal.',
    geneAssociationMode: 'expression_correlation' as const,
    geneAssociations: [
      { gene: 'CCND1', weight: 0.81 },
      { gene: 'CDK6', weight: 0.62 },
      { gene: 'MCM5', weight: 0.51 },
    ],
    pathways: [
      { term: 'HALLMARK_G2M_CHECKPOINT', adjP: 0.0214, database: 'Hallmark' },
    ],
    canonicalOverlap: [
      { gene: 'CCND1', signatures: ['myc_targets', 'bcr_abl'] },
    ],
  },
  {
    id: 'F0004',
    status: 'validated' as const,
    shortcutR2: 0.09,
    shortcutProbeDescription: 'Library size proxy fallback in MVP',
    auditSummary: 'Supportive signaling feature in the BCR-ABL / PTPN11 branch.',
    geneAssociationMode: 'expression_correlation' as const,
    geneAssociations: [
      { gene: 'PTPN11', weight: 0.68 },
      { gene: 'AKT1', weight: 0.55 },
      { gene: 'MCL1', weight: 0.52 },
    ],
    pathways: [
      { term: 'KEGG_ERBB_SIGNALING_PATHWAY', adjP: 0.038, database: 'KEGG' },
    ],
    canonicalOverlap: [
      { gene: 'PTPN11', signatures: ['bcr_abl'] },
      { gene: 'MCL1', signatures: ['bcr_abl'] },
    ],
  },
  {
    id: 'F0005',
    status: 'shortcut' as const,
    shortcutR2: 0.63,
    shortcutProbeDescription: 'Library size proxy fallback in MVP',
    auditSummary: 'Strong coupling to the library-size proxy; marked as likely shortcut activity.',
    geneAssociationMode: 'none' as const,
    geneAssociations: [],
    pathways: [],
    canonicalOverlap: [],
  },
]

export const mockFeatures: FeaturesFile = featureMetadata.map((feature, index) => {
  const values = featureActivations[feature.id]
  const means = perturbationMeans(values)

  return {
    ...feature,
    rank: index + 1,
    attribution: mean(values),
    l0: l0(values),
    activeCells: countActive(values),
    topPerturbations: Object.entries(means)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([perturbation, meanActivation]) => ({
        perturbation,
        meanActivation: Number(meanActivation.toFixed(4)),
      })),
    perturbationMeanActivations: means,
  }
})

const activationRanges = Object.fromEntries(
  Object.entries(featureActivations).map(([featureId, values]) => [
    featureId,
    [Math.min(...values), Math.max(...values)] as [number, number],
  ]),
)

export const mockEmbedding: EmbeddingFile = {
  cells,
  featureActivations,
  activationRanges,
  caveat:
    'Set-conditioned: each cell point represents a token feature vector that can already contain context from other cells in its inference window.',
}

export const mockMatrix: MatrixFile = {
  perturbations,
  featureIds: mockFeatures.map((feature) => feature.id),
  values: perturbations.map((perturbation) =>
    mockFeatures.map((feature) => {
      const raw = feature.perturbationMeanActivations[perturbation] ?? 0
      const max = Math.max(...Object.values(feature.perturbationMeanActivations), 1)
      return Number((raw / max).toFixed(4))
    }),
  ),
  normalization: 'Per-feature max over exported perturbation means',
}

export const mockMethod: MethodFile = {
  metricGlossary: [
    {
      label: 'CRISPRi knockdown',
      body: 'CRISPR interference reduces expression of the targeted gene without cutting DNA.',
    },
    {
      label: 'non-targeting',
      body: 'Control cells carrying a guide that should not repress a human gene.',
    },
    {
      label: 'SAE feature',
      body: 'A latent dimension in the sparse autoencoder dictionary extracted from STATE activations.',
    },
    {
      label: 'Attribution',
      body: 'Mean activation of a feature across all exported cells. Higher means the feature fires more on average.',
    },
    {
      label: 'L0',
      body: 'Percentage of cells where this feature has any positive activation.',
    },
    {
      label: 'Dense feature',
      body: 'A feature with very high L0 that fires in most cells.',
    },
    {
      label: 'Shortcut R²',
      body: 'How much of this feature\'s variance is explained by the configured technical probe.',
    },
    {
      label: 'Set-conditioned',
      body: 'Each cell embedding is computed in the context of the other cells in its inference window.',
    },
    {
      label: 'Canonical overlap',
      body: 'Overlap between top associated genes for a feature and curated K562 signatures.',
    },
    {
      label: 'UMAP',
      body: 'A two-dimensional view of cell embeddings where nearby points have more similar internal activations.',
    },
    {
      label: 'HVG',
      body: 'Highly variable genes used for association scoring in this prototype.',
    },
    {
      label: 'Residual stream',
      body: 'The internal transformer representation from which feature activations are extracted.',
    },
  ],
  fellowshipScope: [
    {
      title: 'Tahoe-100M scale-up',
      body: 'This K562 mock mirrors a feasibility baseline; fellowship scope scales the same pipeline to Tahoe-100M where sparse features are trained under broader perturbation diversity and stronger treatment-response structure.',
    },
    {
      title: 'Layer sweep',
      body: 'Fellowship execution compares matched SAE runs across multiple internal layers and selects depth using shared quality gates rather than a single default layer assumption.',
    },
    {
      title: 'Richer shortcut probes',
      body: 'Shortcut auditing expands beyond library size to stronger metadata probes so technical confounders are explicitly measured and filtered before interpretation.',
    },
    {
      title: 'Causal steering on Trametinib/C32',
      body: 'Causal steering remains future work: intervene on feature clusters during inference and test for coherent, measurable transcriptomic shifts in Trametinib-response settings.',
    },
    {
      title: 'STACK extension',
      body: 'The same interpretability scaffolding is intended to extend beyond STATE to related architectures such as STACK and preserve the same reporting contract.',
    },
    {
      title: 'Integrated Gradients / circuit tracing',
      body: 'Feature-level interpretation is expanded with attribution and circuit tracing so mechanism claims are tied to directional contribution paths, not only feature rankings.',
    },
  ],
  stages: [
    {
      id: 'stage-1',
      title: 'Checkpoint load and sparse feature extraction',
      status: 'current',
      body: 'Mock payload mirroring the real build: a public STATE checkpoint is hooked at layer 4, layer-width 328 activations are exported, and a TopK sparse autoencoder provides the feature dictionary shown in the UI.',
    },
    {
      id: 'stage-2',
      title: 'Shortcut audit and bias probing',
      status: 'current',
      body: 'Mock shortcut metrics mimic the real build\'s library-size proxy so the UI can surface validated, review, and dense-feature states.',
    },
    {
      id: 'stage-3',
      title: 'Biological grounding against canonical K562 programs',
      status: 'current',
      body: 'Mock associations, overlap chips, and pathway sections mirror the structure of the real K562 export so the Method tab can be validated locally.',
    },
    {
      id: 'stage-4',
      title: 'Causal steering via activation patching',
      status: 'future',
      body: 'Mock mode keeps the future-work framing visible: causal steering is not executed here and remains part of the fellowship research scope.',
    },
  ],
  honestyCaveats: [
    'This visualizer surfaces sparse features extracted from Arc Institute\'s STATE State Transition module. Activations are set-conditioned: each cell\'s representation was computed alongside the other cells in its 64-cell covariate-matched inference window, so features may encode relational signals rather than purely cell-autonomous biology. Gene bars show Spearman expression-correlation associations, not projected decoder weights. The shortcut probe is library size - a proxy; richer guide- and batch-aware audits are the full fellowship pipeline\'s Stage 2 contribution.',
    'This mock payload is for local UI development; it is not itself a biological result.',
    'Causal steering is not executed in mock mode.',
  ],
  datasetProvenance: {
    datasetLabel: 'Replogle K562 Essential Perturb-seq (CRISPRi)',
    datasetDoi: '10.1016/j.cell.2022.05.013',
    modelRunLabel: 'ST-HVG-Replogle/fewshot/k562',
    checkpoint: 'arcinstitute/ST-HVG-Replogle/fewshot/k562',
    hookSite: 'transformer_backbone.layers.4',
    hiddenWidth: '328',
    inferenceWindow: '64 cells',
    exportedCells: '24',
    deadFeatureFraction: '22.5%',
    shortcutProbe: 'Library size (total UMI count)',
    geneAssociations: 'Spearman expression correlation',
    pathwayDatabases: 'MSigDB Hallmark, KEGG Medicus',
    saeConfig: {
      layer: 4,
      architecture: 'TopK',
      expansionFactor: 2,
      k: 32,
      epochs: 30,
    },
    shortcutProbeDescription: 'Library size (total UMI count)',
  },
}

export const mockManifest: Manifest = {
  datasetLabel: 'Replogle K562 Essential CRISPRi',
  datasetDoi: '10.1016/j.cell.2022.05.013',
  modelLabel: 'STATE',
  modelRunLabel: 'ST-HVG-Replogle/fewshot/k562',
  modelUrl: 'https://huggingface.co/arcinstitute/ST-HVG-Replogle/tree/main/fewshot/k562',
  saeConfig: {
    layer: 4,
    architecture: 'TopK',
    expansionFactor: 2,
    k: 32,
  },
  shortcutProbe: 'Library size proxy fallback in MVP',
  canonicalSignatures: ['MYC targets', 'BCR-ABL effectors'],
  availableLayers: [4],
  defaultLayer: 4,
  defaultFeatureId: 'F0000',
  defaultPerturbation: 'MYC',
  defaultTheme: 'light',
  filePaths: {
    features: '/data/features.json',
    embedding: '/data/embedding.json',
    matrix: '/data/matrix.json',
    method: '/data/method.json',
  },
}
