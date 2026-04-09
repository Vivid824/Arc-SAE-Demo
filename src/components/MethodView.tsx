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
  const experimentalContext = method.honestyCaveats[0] ?? ''
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
          {method.intro ??
            'Technical report for how this build was generated and what we can currently interpret biologically. Gene names in the perturbation strip (NCBP2, MED10, etc.) are human genes targeted by CRISPRi knockdown. See the Glossary section below for all terms.'}
        </p>
      </div>

      <article className="experimental-context">
        <span className="experimental-context-label">
          {method.experimentalContextLabel ?? 'Experimental context'}
        </span>
        <p className="section-copy">{experimentalContext}</p>
        {modeSpecificNote ? <p className="section-copy method-inline-note">{modeSpecificNote}</p> : null}
      </article>

      <section className="method-section method-stages">
        {method.stages.map((stage, index) => (
          <article key={stage.id} className="stage-row">
            <div className="stage-number" aria-hidden="true">
              {index + 1}
            </div>
            <div>
              <div className="stage-title">
                <span>{stage.title}</span>
                {stage.status ? (
                  <span className={`stage-badge ${stage.status}`}>
                    {stageStatusLabels[stage.status]}
                  </span>
                ) : null}
              </div>
              <p className="stage-body">{stage.body}</p>
            </div>
          </article>
        ))}
      </section>

      {showGlossary ? (
        <section className="glossary-section method-section">
          <h2 className="section-label">Glossary</h2>
          <dl className="method-glossary-grid">
            {method.metricGlossary!.map((item) => (
              <div key={item.label} className="glossary-entry">
                <dt className="glossary-term">{item.label}</dt>
                <dd className="glossary-def">{item.body}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className="method-section">
        <h2 className="section-label">Provenance</h2>
        <dl className="provenance-grid">
          {provenanceEntries.map(([label, value]) => (
            <div key={label} className="prov-card">
              <dt className="prov-label">{label}</dt>
              <dd className="prov-value">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {showFellowshipScope ? (
        <article className="fellowship-box method-section">
          <div className="fellowship-header">Full fellowship research scope</div>
          <div className="fellowship-list">
            {method.fellowshipScope!.map((item, index) => (
              <div key={item.title} className="fellowship-item">
                <div className="fellowship-num">{index + 1}.</div>
                <div className="fellowship-text">
                  <strong>{item.title}.</strong> {item.body}
                </div>
              </div>
            ))}
          </div>
        </article>
      ) : null}
    </div>
  )
}
