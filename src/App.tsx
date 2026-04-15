import { useEffect, useMemo, useState } from 'react'
import { AppShell } from './components/AppShell'
import { ErrorState } from './components/ErrorState'
import { DataLoadError, describeDataLoadError, loadAppData } from './lib/loadData'
import { computeExtendedShortcuts } from './lib/attributionMath'
import { filterFeatures, sortFeatures } from './lib/sort'
import type { LoadedDataset, ThemeName } from './lib/schema'
import { applyTheme, readStoredTheme, resolveTheme, writeStoredTheme } from './lib/theme'
import type { MobileTab, ViewTab } from './types'
import './styles/tokens.css'
import './styles/layout.css'

function App() {
  const [dataset, setDataset] = useState<LoadedDataset | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [query, setQuery] = useState('')
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null)
  const [selectedPerturbationId, setSelectedPerturbationId] = useState<string | null>(null)
  const [selectionInitialized, setSelectionInitialized] = useState(false)
  const [viewTab, setViewTab] = useState<ViewTab>('explorer')
  const [mobileTab, setMobileTab] = useState<MobileTab>('explorer')
  const [theme, setTheme] = useState<ThemeName>(() =>
    resolveTheme(readStoredTheme(), null),
  )

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const controller = new AbortController()

    loadAppData(controller.signal)
      .then((loaded) => {
        // Check if aborted before updating state
        if (controller.signal.aborted) {
          return
        }

        // Compute extended shortcut probes for all features
        const featuresWithProbes = loaded.features.map((feature) => ({
          ...feature,
          shortcutProbes: computeExtendedShortcuts(feature, loaded.embedding),
        }))

        setDataset({
          ...loaded,
          features: featuresWithProbes,
        })

        const storedTheme = readStoredTheme()
        if (!storedTheme) {
          setTheme(resolveTheme(null, loaded.manifest.defaultTheme))
        }

        setSelectedPerturbationId(
          loaded.manifest.defaultPerturbation ??
            Object.keys(loaded.features[0]?.perturbationMeanActivations ?? {})[0] ??
            null,
        )
        setSelectedFeatureId(loaded.manifest.defaultFeatureId)
        setSelectionInitialized(true)
      })
      .catch((nextError) => {
        // Ignore abort errors (from React StrictMode double-mount in dev)
        if (nextError.name === 'AbortError' || controller.signal.aborted) {
          return
        }
        setError(nextError instanceof Error ? nextError : new Error(String(nextError)))
      })

    return () => controller.abort()
  }, [])

  const perturbations = useMemo(() => {
    if (!dataset) {
      return []
    }

    return [
      ...new Set(
        dataset.features.flatMap((feature) =>
          Object.keys(feature.perturbationMeanActivations),
        ),
      ),
    ]
  }, [dataset])

  const filteredFeatures = useMemo(() => {
    if (!dataset) {
      return []
    }

    return filterFeatures(sortFeatures(dataset.features, selectedPerturbationId), query)
  }, [dataset, query, selectedPerturbationId])

  useEffect(() => {
    if (!selectionInitialized) {
      return
    }

    if (!filteredFeatures.length) {
      setSelectedFeatureId(null)
      return
    }

    if (!selectedFeatureId || !filteredFeatures.some((feature) => feature.id === selectedFeatureId)) {
      setSelectedFeatureId(filteredFeatures[0]?.id ?? null)
    }
  }, [filteredFeatures, selectedFeatureId, selectionInitialized])

  const selectedFeature =
    filteredFeatures.find((feature) => feature.id === selectedFeatureId) ??
    dataset?.features.find((feature) => feature.id === selectedFeatureId) ??
    null

  const toggleTheme = () => {
    const nextTheme: ThemeName = theme === 'light' ? 'dark' : 'light'
    setTheme(nextTheme)
    writeStoredTheme(nextTheme)
  }

  if (error) {
    const errorDetails =
      error instanceof DataLoadError
        ? describeDataLoadError(error)
        : error.stack ?? error.message

    return (
      <ErrorState
        title="Unable to load the explorer"
        message="Real data could not be loaded or validated. Check the details for the exact failing file and schema step."
        details={errorDetails}
      />
    )
  }

  if (!dataset) {
    return (
      <div className="loading-shell">
        <div className="loading-card panel">
          <h1 className="view-title">Loading explorer</h1>
          <p className="section-copy">Validating manifest and feature payloads.</p>
        </div>
      </div>
    )
  }

  return (
    <AppShell
      dataset={dataset}
      perturbations={perturbations}
      features={filteredFeatures}
      selectedFeature={selectedFeature}
      selectedFeatureId={selectedFeatureId}
      selectedPerturbationId={selectedPerturbationId}
      query={query}
      theme={theme}
      viewTab={viewTab}
      mobileTab={mobileTab}
      onQueryChange={setQuery}
      onSelectFeature={setSelectedFeatureId}
      onSelectPerturbation={setSelectedPerturbationId}
      onSetViewTab={setViewTab}
      onSetMobileTab={setMobileTab}
      onToggleTheme={toggleTheme}
    />
  )
}

export default App
