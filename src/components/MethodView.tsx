import type { MethodFile } from '../lib/schema'

type MethodViewProps = {
  method: MethodFile
  geneAssociationMode?: 'projected_hvg_decoder' | 'expression_correlation' | 'none'
}

const stageStatusLabels = {
  current: 'Completed in this build',
  future: 'Future fellowship work',
} as const

export function MethodView({ method, geneAssociationMode }: MethodViewProps) {
  const [experimentalContext, ...additionalCaveats] = method.honestyCaveats
  const showGlossary = Array.isArray(method.metricGlossary) && method.metricGlossary.length > 0
  const showFellowshipScope =
    Array.isArray(method.fellowshipScope) && method.fellowshipScope.length > 0

  const modeSpecificNote =
    geneAssociationMode === 'projected_hvg_decoder'
      ? 'This build note: gene bars are projected HVG-space decoder weights.'
      : geneAssociationMode === 'none'
        ? 'This build note: gene bars are not available for this export.'
        : null

  const saeConfig = method.datasetProvenance.saeConfig
  const provenanceEntries = [
    ['Dataset', method.datasetProvenance.datasetLabel],
    ['DOI', method.datasetProvenance.datasetDoi],
    ['Checkpoint', method.datasetProvenance.checkpoint ?? method.datasetProvenance.modelRunLabel],
    ['Hook site', method.datasetProvenance.hookSite],
    ['Hidden width', method.datasetProvenance.hiddenWidth],
    ['Inference window', method.datasetProvenance.inferenceWindow],
    ['Exported cells', method.datasetProvenance.exportedCells?.toString()],
    [
      'SAE config',
      `${saeConfig.architecture} · layer ${saeConfig.layer} · ${saeConfig.expansionFactor}x · k=${saeConfig.k}${
        saeConfig.epochs ? ` · ${saeConfig.epochs} epochs` : ''
      }`,
    ],
    ['Dead-feature fraction', method.datasetProvenance.deadFeatureFraction],
    [
      'Shortcut probe',
      method.datasetProvenance.shortcutProbe ?? method.datasetProvenance.shortcutProbeDescription,
    ],
    ['Gene associations', method.datasetProvenance.geneAssociations],
    ['Pathway databases', method.datasetProvenance.pathwayDatabases],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))

  return (
    <div className="view-stack method-report">
      <div className="view-intro method-intro">
        <h1 className="view-title">Method</h1>
        <p className="view-copy method-subtitle">
          Technical report for how this build was generated and what we can currently interpret biologically. Gene names in the perturbation strip (NCBP2, MED10, etc.) are human genes targeted by CRISPRi knockdown. See the Glossary section below for all terms.
        </p>
      </div>

      <article className="method-card experimental-context">
        <span className="experimental-context-label">Experimental context</span>
        <p className="section-copy">{experimentalContext}</p>
        {modeSpecificNote ? <p className="section-copy method-inline-note">{modeSpecificNote}</p> : null}
      </article>

      <section className="method-section method-stages">
        {method.stages.map((stage, index) => (
          <div key={stage.id} className="method-stage-block">
            {index > 0 ? <hr className="stage-divider" /> : null}
            <article className="method-stage-row">
              <div className="method-stage-number" aria-hidden="true">
                {index + 1}
              </div>
              <div className="method-stage-body">
                <div className="method-stage-header">
                  <h2 className="section-title">{stage.title}</h2>
                  {stage.status ? (
                    <span className={`method-status-badge status-${stage.status}`}>
                      {stageStatusLabels[stage.status]}
                    </span>
                  ) : null}
                </div>
                <p className="section-copy">{stage.body}</p>
              </div>
            </article>
          </div>
        ))}
      </section>

      {showGlossary ? (
        <article className="method-section">
          <h2 className="section-title">Glossary</h2>
          <dl className="method-glossary-grid">
            {method.metricGlossary!.map((item) => (
              <div key={item.label} className="method-glossary-item">
                <dt>{item.label}</dt>
                <dd>{item.body}</dd>
              </div>
            ))}
          </dl>
        </article>
      ) : null}

      {additionalCaveats.length > 0 ? (
        <article className="method-section">
          <h2 className="section-title">Additional caveats</h2>
          <ul className="method-list">
            {additionalCaveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </article>
      ) : null}

      <article className="method-section">
        <h2 className="section-title">Provenance</h2>
        <dl className="method-provenance-grid">
          {provenanceEntries.map(([label, value]) => (
            <div key={label} className="method-provenance-card">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </article>

      {showFellowshipScope ? (
        <article className="method-card method-scope-card method-section">
          <h2 className="section-title">Full fellowship research scope</h2>
          <ol className="method-scope-list">
            {method.fellowshipScope!.map((item) => (
              <li key={item.title} className="method-scope-item">
                <p className="section-copy">
                  <strong>{item.title}.</strong> {item.body}
                </p>
              </li>
            ))}
          </ol>
        </article>
      ) : null}
    </div>
  )
}
