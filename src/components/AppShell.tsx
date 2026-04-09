import { useEffect, useState } from 'react'
import { ExplorerView } from './ExplorerView'
import { FeatureDetail } from './FeatureDetail'
import { FeatureList } from './FeatureList'
import { HeatmapView } from './HeatmapView'
import { MethodView } from './MethodView'
import { TopBar } from './TopBar'
import type { LoadedDataset } from '../lib/schema'
import type { MobileTab, ViewTab } from '../types'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 900 : false,
  )

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 900)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return isMobile
}

type AppShellProps = {
  dataset: LoadedDataset
  perturbations: string[]
  features: LoadedDataset['features']
  selectedFeature: LoadedDataset['features'][number] | null
  selectedFeatureId: string | null
  selectedPerturbationId: string | null
  query: string
  theme: LoadedDataset['manifest']['defaultTheme']
  viewTab: ViewTab
  mobileTab: MobileTab
  onQueryChange: (value: string) => void
  onSelectFeature: (id: string) => void
  onSelectPerturbation: (id: string) => void
  onSetViewTab: (value: ViewTab) => void
  onSetMobileTab: (value: MobileTab) => void
  onToggleTheme: () => void
}

export function AppShell({
  dataset,
  perturbations,
  features,
  selectedFeature,
  selectedFeatureId,
  selectedPerturbationId,
  query,
  theme,
  viewTab,
  mobileTab,
  onQueryChange,
  onSelectFeature,
  onSelectPerturbation,
  onSetViewTab,
  onSetMobileTab,
  onToggleTheme,
}: AppShellProps) {
  const isMobile = useIsMobile()

  const handleFeatureSelect = (id: string) => {
    onSelectFeature(id)
    if (isMobile) {
      onSetMobileTab('detail')
    }
  }

  const renderCenter = (tab: ViewTab) => {
    if (tab === 'heatmap') {
      return (
        <HeatmapView
          matrix={dataset.matrix}
          selectedPerturbationId={selectedPerturbationId}
        />
      )
    }

    if (tab === 'method') {
      return (
        <MethodView
          method={dataset.method}
          geneAssociationMode={dataset.features[0]?.geneAssociationMode}
        />
      )
    }

    return <ExplorerView embedding={dataset.embedding} selectedFeature={selectedFeature} />
  }

  const renderMobilePanel = () => {
    switch (mobileTab) {
      case 'features':
        return (
          <FeatureList
            features={features}
            query={query}
            onQueryChange={onQueryChange}
            selectedFeatureId={selectedFeatureId}
            selectedPerturbationId={selectedPerturbationId}
            onSelectFeature={handleFeatureSelect}
          />
        )
      case 'detail':
        return <FeatureDetail feature={selectedFeature} />
      case 'heatmap':
        return renderCenter('heatmap')
      case 'method':
        return renderCenter('method')
      default:
        return renderCenter('explorer')
    }
  }

  return (
    <div className="app-shell">
      <TopBar
        manifest={dataset.manifest}
        perturbations={perturbations}
        selectedPerturbationId={selectedPerturbationId}
        onPerturbationChange={onSelectPerturbation}
        viewTab={viewTab}
        onViewTabChange={onSetViewTab}
        mobileTab={mobileTab}
        onMobileTabChange={onSetMobileTab}
        theme={theme}
        onToggleTheme={onToggleTheme}
        isMobile={isMobile}
      />

      {dataset.source === 'mock' ? (
        <div className="source-banner">
          Running with mock data while `/public/data/manifest.json` is unavailable.
          {dataset.fallbackReason ? ` ${dataset.fallbackReason}` : ''}
        </div>
      ) : null}
      {dataset.warnings && dataset.warnings.length > 0 ? (
        <div className="data-warning-banner" role="status" aria-live="polite">
          <strong>Data preflight warnings</strong>
          <ul>
            {dataset.warnings.slice(0, 6).map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {isMobile ? (
        <main className="mobile-stage">{renderMobilePanel()}</main>
      ) : (
        <main className="workspace">
          <FeatureList
            features={features}
            query={query}
            onQueryChange={onQueryChange}
            selectedFeatureId={selectedFeatureId}
            selectedPerturbationId={selectedPerturbationId}
            onSelectFeature={handleFeatureSelect}
          />
          <section className="panel center-panel">{renderCenter(viewTab)}</section>
          <FeatureDetail feature={selectedFeature} />
        </main>
      )}
    </div>
  )
}
