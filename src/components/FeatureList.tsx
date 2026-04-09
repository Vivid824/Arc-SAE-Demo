import type { CSSProperties } from 'react'
import { List, type RowComponentProps } from 'react-window'
import { formatDisplayValue } from '../lib/format'
import type { FeatureRecord } from '../lib/schema'

type FeatureRowData = {
  features: FeatureRecord[]
  selectedFeatureId: string | null
  selectedPerturbationId: string | null
  onSelectFeature: (id: string) => void
}

function FeatureRow({
  index,
  style,
  features,
  selectedFeatureId,
  selectedPerturbationId,
  onSelectFeature,
}: RowComponentProps<FeatureRowData>) {
  const feature = features[index]
  if (!feature) {
    return null
  }

  const isSelected = feature.id === selectedFeatureId
  const perturbationValue =
    selectedPerturbationId && feature.perturbationMeanActivations[selectedPerturbationId] !== undefined
      ? feature.perturbationMeanActivations[selectedPerturbationId]
      : null
  const hasCanonicalOverlap = feature.canonicalOverlap.length > 0
  const dotClass = hasCanonicalOverlap
    ? 'status-dot-canonical'
    : feature.status === 'shortcut'
      ? 'status-dot-shortcut'
      : feature.status === 'review'
        ? 'status-dot-review'
        : 'status-dot-none'

  return (
    <div style={style as CSSProperties} className="feature-row-shell">
      <button
        type="button"
        className={`feature-row${isSelected ? ' is-selected' : ''}`}
        onClick={() => onSelectFeature(feature.id)}
        title={feature.geneAssociations.map(({ gene }) => gene).join(', ')}
      >
        <span className={`status-dot ${dotClass}`} />
        <span className="feature-row-id">
          {feature.id}
          {feature.l0 > 90 ? (
            <span
              className="dense-badge"
              title="Dense feature: this latent activates in most cells (high L0), so it may be less specific."
            >
              Dense
            </span>
          ) : null}
        </span>
        <span className="feature-row-value">
          {perturbationValue !== null
            ? formatDisplayValue(perturbationValue)
            : formatDisplayValue(feature.attribution)}
        </span>
      </button>
    </div>
  )
}

type FeatureListProps = {
  features: FeatureRecord[]
  query: string
  onQueryChange: (query: string) => void
  selectedFeatureId: string | null
  selectedPerturbationId: string | null
  onSelectFeature: (id: string) => void
}

export function FeatureList({
  features,
  query,
  onQueryChange,
  selectedFeatureId,
  selectedPerturbationId,
  onSelectFeature,
}: FeatureListProps) {
  const hasQuery = query.trim().length > 0
  const isEmptySearch = hasQuery && features.length === 0

  return (
    <section className="panel rail">
      <div className="rail-header">
        <h2 className="section-title">SAE features</h2>
        <p className="section-copy">Features sorted by global attribution. Select a perturbation pill to re-rank.</p>
        <p className="section-copy">
          {selectedPerturbationId
            ? `Pill sort active for ${selectedPerturbationId}.`
            : 'Global attribution sort active.'}
        </p>
      </div>

      <label className="search-field">
        <span>Search</span>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Feature, gene, or pathway"
        />
      </label>

      {isEmptySearch ? (
        <div className="feature-empty-state" role="status" aria-live="polite">
          No features match this search.
        </div>
      ) : (
        <div className="feature-list-container">
          <List
            defaultHeight={420}
            rowComponent={FeatureRow}
            rowCount={features.length}
            rowHeight={34}
            rowProps={{
              features,
              selectedFeatureId,
              selectedPerturbationId,
              onSelectFeature,
            }}
            overscanCount={8}
            style={{ height: '100%' }}
          />
        </div>
      )}
    </section>
  )
}
