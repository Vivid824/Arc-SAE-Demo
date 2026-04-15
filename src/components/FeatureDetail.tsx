import type { CSSProperties } from 'react'
import { formatDisplayValue, formatPathwayPValue } from '../lib/format'
import type { FeatureRecord } from '../lib/schema'

type FeatureDetailProps = {
  feature: FeatureRecord | null
}

export function FeatureDetail({ feature }: FeatureDetailProps) {
  if (!feature) {
    return (
      <section className="panel rail">
        <div className="rail-header">
          <h2 className="section-title">Feature detail</h2>
          <p className="section-copy">Select a feature to inspect its summary.</p>
        </div>
      </section>
    )
  }

  const geneAssociationTitle =
    feature.geneAssociationMode === 'projected_hvg_decoder'
      ? 'Projected decoder weights (HVG space)'
      : feature.geneAssociationMode === 'expression_correlation'
        ? 'Gene associations (expression correlation)'
        : 'Gene associations'

  const formatCanonicalTitle = (signatures: string[]) => {
    if (signatures.length === 0) {
      return ''
    }

    const labels = signatures.map((signature) => {
      if (signature === 'myc_targets') {
        return 'MYC targets'
      }
      if (signature === 'bcr_abl') {
        return 'BCR-ABL effectors'
      }
      return signature
    })
    return labels.join(', ')
  }

  const maxAbsWeight = Math.max(
    1e-6,
    ...feature.geneAssociations.map((association) => Math.abs(association.weight)),
  )

  return (
    <section className="panel rail detail-rail">
      <div className="feature-hero">
        <div className="feature-id">{feature.id}</div>
        <div className="section-copy">
          Rank {feature.rank} - attribution {formatDisplayValue(feature.attribution)}
        </div>
      </div>

      <div className={`audit-banner audit-banner-quiet status-${feature.status}`}>
        <strong>{feature.status}</strong>
        <span>{feature.auditSummary}</span>
      </div>

      <div className="detail-grid">
        <div>
          <dt>L0</dt>
          <dd>
            {feature.l0.toFixed(1)}%
            {feature.l0 > 90 ? (
              <span
                className="dense-badge detail-dense-badge"
                title="Dense feature: this latent activates in most cells (high L0), so it may be less specific."
              >
                Dense
              </span>
            ) : null}
          </dd>
        </div>
        {feature.l0 > 90 ? null : (
          <div>
            <dt>Active cells</dt>
            <dd>{feature.activeCells}</dd>
          </div>
        )}
      </div>

      <div className="detail-section">
        <h3 className="section-title">Shortcut Detection</h3>
        <p className="section-copy">
          Technical bias probes testing whether feature captures biological signal or
          artifacts.
        </p>
        {feature.shortcutProbes && feature.shortcutProbes.length > 0 ? (
          <table className="shortcut-probe-table" style={{ width: '100%', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color, #e5e7eb)' }}>
                <th style={{ textAlign: 'left', padding: '8px 4px' }}>Probe</th>
                <th style={{ textAlign: 'right', padding: '8px 4px' }}>R²</th>
                <th style={{ textAlign: 'center', padding: '8px 4px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {feature.shortcutProbes.map((probe) => (
                <tr key={probe.probeName}>
                  <td style={{ padding: '8px 4px' }}>{probe.probeName}</td>
                  <td style={{ textAlign: 'right', padding: '8px 4px', fontVariantNumeric: 'tabular-nums' }}>
                    {probe.r2.toFixed(3)}
                  </td>
                  <td style={{ textAlign: 'center', padding: '8px 4px' }}>
                    <span
                      className={`badge badge-${probe.status}`}
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 500,
                        background:
                          probe.status === 'pass'
                            ? '#d1fae5'
                            : probe.status === 'warning'
                              ? '#fef3c7'
                              : '#fee2e2',
                        color:
                          probe.status === 'pass'
                            ? '#065f46'
                            : probe.status === 'warning'
                              ? '#92400e'
                              : '#991b1b',
                      }}
                    >
                      {probe.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="detail-grid">
            <div>
              <dt>Shortcut R²</dt>
              <dd>{feature.shortcutR2.toFixed(3)}</dd>
            </div>
          </div>
        )}
      </div>

      <div className="detail-section">
        <h3 className="section-title">{geneAssociationTitle}</h3>
        <div className="gene-list">
          {feature.geneAssociations.length === 0 ? (
            <p className="section-copy">
              {feature.geneAssociationMode === 'none'
                ? 'No gene associations are available for this feature.'
                : 'No ranked gene associations are available for this feature.'}
            </p>
          ) : (
            feature.geneAssociations.map((association, index) => (
              <div key={`${feature.id}-${association.gene}-${index}`} className="gene-row">
                <span className="gene-name">{association.gene}</span>
                <span className="gene-bar-shell">
                  <span className="gene-zero-line" />
                  {association.weight !== 0 ? (
                    <span
                      className={`gene-bar ${
                        association.weight >= 0 ? 'gene-bar-positive' : 'gene-bar-negative'
                      }`}
                      style={
                        {
                          '--gene-bar-width': `${Math.min(
                            50,
                            (Math.abs(association.weight) / maxAbsWeight) * 50,
                          )}%`,
                        } as CSSProperties
                      }
                    />
                  ) : null}
                </span>
                <span className="gene-weight">{association.weight.toFixed(2)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="detail-section">
        <h3 className="section-title">Canonical overlap</h3>
        <p className="section-copy">
          Genes matching canonical K562 signatures (MYC targets / BCR-ABL effectors).
        </p>
        <div className="chip-row">
          {feature.canonicalOverlap.length === 0 ? (
            <p className="section-copy canonical-empty-note">
              No overlap with MYC-target or BCR-ABL effector gene sets detected.
            </p>
          ) : (
            feature.canonicalOverlap.map((entry) => (
              <span
                key={`${feature.id}-${entry.gene}`}
                className="gene-chip"
                title={formatCanonicalTitle(entry.signatures)}
              >
                {entry.gene}
                {entry.signatures.length > 1 ? '*' : ''}
              </span>
            ))
          )}
        </div>
      </div>

      <div className="detail-section">
        <h3 className="section-title">Pathways</h3>
        <p className="section-copy">
          Adjusted p-value (Benjamini-Hochberg) against Hallmark and KEGG Medicus gene sets.
        </p>
        <div className="detail-list">
          {feature.pathways.length === 0 ? (
            <p className="section-copy">No significant enrichment detected.</p>
          ) : (
            feature.pathways.map((pathway) => (
              <div key={`${feature.id}-${pathway.term}`} className="detail-row">
                <span className="pathway-term" title={pathway.term}>
                  {pathway.term}
                </span>
                <span className="pathway-pval">
                  {formatPathwayPValue(pathway.adjP)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="detail-section">
        <h3 className="section-title">Top perturbations</h3>
        <div className="detail-list">
          {feature.topPerturbations.length === 0 ? (
            <p className="section-copy">No perturbation summary available.</p>
          ) : (
            feature.topPerturbations.map((entry) => (
              <div key={`${feature.id}-${entry.perturbation}`} className="detail-row">
                <span>{entry.perturbation}</span>
                <span>{formatDisplayValue(entry.meanActivation)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
