import type { ThemeName } from '../lib/schema'
import type { Manifest } from '../lib/schema'
import type { MobileTab, ViewTab } from '../types'

type TopBarProps = {
  manifest: Manifest
  perturbations: string[]
  selectedPerturbationId: string | null
  onPerturbationChange: (perturbation: string) => void
  viewTab: ViewTab
  onViewTabChange: (tab: ViewTab) => void
  mobileTab: MobileTab
  onMobileTabChange: (tab: MobileTab) => void
  theme: ThemeName
  onToggleTheme: () => void
  isMobile: boolean
}

const viewLabels: Record<ViewTab, string> = {
  explorer: 'Explorer',
  heatmap: 'Heatmap',
  attribution: 'Attribution',
  interactions: 'Interactions',
  method: 'Method',
}

const viewDescriptions: Record<ViewTab, string> = {
  explorer: 'UMAP of cell embeddings colored by feature activation. Each point is one cell.',
  heatmap: 'Feature × perturbation activation matrix.',
  attribution: 'Gradient attribution showing which features influence each perturbation.',
  interactions: 'Network graph of feature co-activation patterns.',
  method: 'Pipeline transparency and technical notes.',
}

const mobileTabs: MobileTab[] = [
  'features',
  'explorer',
  'heatmap',
  'attribution',
  'interactions',
  'method',
  'detail',
]
const desktopTabs: ViewTab[] = ['explorer', 'heatmap', 'attribution', 'interactions', 'method']

function isControlPerturbation(perturbation: string) {
  return perturbation === 'non-targeting'
}

function renderPerturbationLabel(perturbation: string) {
  return isControlPerturbation(perturbation) ? 'non-targeting (control)' : perturbation
}

export function TopBar({
  manifest,
  perturbations,
  selectedPerturbationId,
  onPerturbationChange,
  viewTab,
  onViewTabChange,
  mobileTab,
  onMobileTabChange,
  theme,
  onToggleTheme,
  isMobile,
}: TopBarProps) {
  const activeTabDescription = isMobile
    ? mobileTab === 'features'
      ? 'Features sorted by global attribution. Select a perturbation pill to re-rank.'
      : mobileTab === 'detail'
        ? 'Feature detail rail with associations, pathways, and overlap.'
        : viewDescriptions[(mobileTab as ViewTab) ?? 'explorer'] ?? 'STATE explorer'
    : viewDescriptions[viewTab]

  return (
    <header className="top-bar">
      <div className="top-bar-main">
        <div className="top-bar-brand">
          <div className="app-kicker">STATE Interpretability Explorer</div>
          <div className="app-meta">
            {manifest.datasetLabel} - {manifest.modelRunLabel} - layer {manifest.defaultLayer}
          </div>
        </div>

        <div className="top-bar-actions">
          <div className="tab-strip">
            {(isMobile ? mobileTabs : desktopTabs).map((tab) => {
              const active = isMobile ? mobileTab === tab : viewTab === tab
              const label = isMobile
                ? tab.charAt(0).toUpperCase() + tab.slice(1)
                : viewLabels[tab as ViewTab]

              return (
                <button
                  key={tab}
                  type="button"
                  className={`tab-pill${active ? ' is-active' : ''}`}
                  onClick={() =>
                    isMobile
                      ? onMobileTabChange(tab as MobileTab)
                      : onViewTabChange(tab as ViewTab)
                  }
                >
                  {label}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={`Toggle theme. Current theme: ${theme}`}
            title={`Current theme: ${theme}`}
          >
            <span className="theme-toggle-icon" aria-hidden="true">
              {theme === 'light' ? '☾' : '☀'}
            </span>
            <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
          </button>
        </div>
      </div>

      <div className="active-tab-description" aria-live="polite">
        {activeTabDescription}
      </div>

      <div className="perturbation-context">
        K562 CRISPRi knockdowns · select to re-rank features
      </div>

      <div className="perturbation-strip-wrap">
        <div className="perturbation-strip" aria-label="Perturbation selector">
          {isMobile ? (
            <label className="perturbation-select">
              <span>Perturbation</span>
              <select
                value={selectedPerturbationId ?? ''}
                onChange={(event) => onPerturbationChange(event.target.value)}
              >
                {perturbations.map((perturbation) => (
                  <option key={perturbation} value={perturbation}>
                    {renderPerturbationLabel(perturbation)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            perturbations.map((perturbation) => (
              <button
                key={perturbation}
                type="button"
                className={`tab-pill perturbation-pill${selectedPerturbationId === perturbation ? ' is-active' : ''}${
                  isControlPerturbation(perturbation) ? ' is-control' : ''
                }`}
                onClick={() => onPerturbationChange(perturbation)}
                title={renderPerturbationLabel(perturbation)}
              >
                {renderPerturbationLabel(perturbation)}
              </button>
            ))
          )}
        </div>
      </div>
    </header>
  )
}
