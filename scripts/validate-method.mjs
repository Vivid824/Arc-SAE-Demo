import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const requiredGlossaryLabels = [
  'CRISPRi knockdown',
  'non-targeting',
  'SAE feature',
  'Attribution',
  'L0',
  'Dense feature',
  'Shortcut R²',
  'Set-conditioned',
  'Canonical overlap',
  'UMAP',
  'HVG',
  'Residual stream',
]

const requiredScopeTitles = [
  'Tahoe-100M scale-up',
  'Systematic layer sweep',
  'Richer shortcut detection',
  'Causal steering on Trametinib/C32',
  'STACK dual-axis extension',
  'Integrated Gradients / circuit tracing',
]

async function loadMethodSchemaFromAppSource() {
  const schemaPath = resolve(process.cwd(), 'src', 'lib', 'schema.ts')
  const schemaTs = await readFile(schemaPath, 'utf8')
  const transpiled = ts.transpileModule(schemaTs, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'schema.ts',
  })

  const tempDir = await mkdtemp(resolve(process.cwd(), '.tmp-method-schema-'))
  const tempSchemaPath = resolve(tempDir, 'schema.mjs')
  await writeFile(tempSchemaPath, transpiled.outputText, 'utf8')

  try {
    const module = await import(pathToFileURL(tempSchemaPath).href)
    if (!module.MethodFileSchema) {
      throw new Error('MethodFileSchema export missing from src/lib/schema.ts')
    }
    return module.MethodFileSchema
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function assertCanonical(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const methodPath = resolve(process.cwd(), 'content', 'method.json')
const raw = await readFile(methodPath, 'utf8')
const parsed = JSON.parse(raw)
const methodSchema = await loadMethodSchemaFromAppSource()
methodSchema.parse(parsed)

assertCanonical(
  parsed.intro ===
    'Technical report for how this build was generated and what we can currently interpret biologically. Gene names in the perturbation strip (NCBP2, MED10, etc.) are human genes targeted by CRISPRi knockdown. See the Glossary section below for all terms.',
  'content/method.json must include the canonical Method intro line.',
)
assertCanonical(
  parsed.experimentalContextLabel === 'Experimental context',
  'content/method.json must use Experimental context as the section label.',
)

assertCanonical(
  Array.isArray(parsed.metricGlossary) && parsed.metricGlossary.length >= requiredGlossaryLabels.length,
  'content/method.json must include the full metricGlossary payload.',
)
assertCanonical(
  Array.isArray(parsed.fellowshipScope) && parsed.fellowshipScope.length >= requiredScopeTitles.length,
  'content/method.json must include the full fellowshipScope payload.',
)

const glossaryLabels = new Set((parsed.metricGlossary ?? []).map((item) => item.label))
for (const label of requiredGlossaryLabels) {
  assertCanonical(glossaryLabels.has(label), `content/method.json is missing glossary entry: ${label}`)
}

const scopeTitles = new Set((parsed.fellowshipScope ?? []).map((item) => item.title))
for (const title of requiredScopeTitles) {
  assertCanonical(scopeTitles.has(title), `content/method.json is missing fellowship scope item: ${title}`)
}

assertCanonical(
  parsed.datasetProvenance?.saeConfig?.architecture === 'TopK',
  'Canonical Method provenance must say TopK.',
)
assertCanonical(
  parsed.datasetProvenance?.saeConfig?.layer === 4,
  'Canonical Method provenance must say layer 4.',
)
assertCanonical(
  parsed.datasetProvenance?.saeConfig?.expansionFactor === 2,
  'Canonical Method provenance must say 2x.',
)
assertCanonical(
  parsed.datasetProvenance?.saeConfig?.k === 32,
  'Canonical Method provenance must say k=32.',
)
assertCanonical(
  parsed.datasetProvenance?.saeConfig?.epochs === 30,
  'Canonical Method provenance must say 30 epochs.',
)
assertCanonical(
  parsed.datasetProvenance?.hookSite === 'transformer_backbone.layers.4',
  'Canonical Method provenance must use hook site transformer_backbone.layers.4.',
)
assertCanonical(
  parsed.datasetProvenance?.hiddenWidth === '328 dimensions',
  'Canonical Method provenance must say hidden width 328 dimensions.',
)
assertCanonical(
  parsed.datasetProvenance?.inferenceWindow === '64 cells per forward pass',
  'Canonical Method provenance must say 64 cells per forward pass.',
)
assertCanonical(
  parsed.datasetProvenance?.exportedCells === '5,120 (20 perturbations × up to 256 cells)',
  'Canonical Method provenance must say 5,120 (20 perturbations × up to 256 cells).',
)
assertCanonical(
  parsed.datasetProvenance?.deadFeatureFraction === '22.5%',
  'Canonical Method provenance must say dead-feature fraction 22.5%.',
)
assertCanonical(
  parsed.datasetProvenance?.shortcutProbe === 'Library size (UMI proxy)',
  'Canonical Method provenance must say Library size (UMI proxy).',
)
assertCanonical(
  parsed.datasetProvenance?.geneAssociations === 'Spearman expression correlation via var_dims.pkl gene ordering',
  'Canonical Method provenance must say Spearman expression correlation via var_dims.pkl gene ordering.',
)
assertCanonical(
  parsed.datasetProvenance?.pathwayDatabases === 'MSigDB Hallmark + KEGG Medicus (hypergeometric, Benjamini-Hochberg)',
  'Canonical Method provenance must say MSigDB Hallmark + KEGG Medicus (hypergeometric, Benjamini-Hochberg).',
)

console.log(`Validated ${methodPath}`)
console.log(`Canonical Method source: ${methodPath}`)
