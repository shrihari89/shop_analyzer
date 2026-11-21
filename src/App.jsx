import { useState, useCallback, useMemo } from 'react'
import './App.css'
import Map from './Map'
import {
  BUSINESS_CATEGORIES,
  NANDED_CITY_BOUNDARY,
  analyzeZonesAndScore,
  calculateAreaKm2,
  getCategoryLabel,
} from './utils/geoAnalysis'
import { AnalysisLoadingModal } from './components/LoadingOverlay'

const CATEGORY_ICONS = {
  pharmacy: '💊',
  grocery: '🛒',
  restaurant: '🍽️',
  clothing: '👕',
  electronics: '📱',
  stationery: '📚',
  hardware: '🔧',
}

function buildFallbackRecommendation(categoryLabel, analysis) {
  const { summary, zones } = analysis
  const lowZones = zones.filter((z) => z.presenceLevel === 'Low')
  const highZones = zones.filter((z) => z.presenceLevel === 'High')

  if (summary.totalBusinesses === 0) {
    return {
      isFallback: true,
      summary: `Google Places returned 0 verified listings for ${categoryLabel} inside the approximate Nanded City boundary. This may indicate very low formal listing density or missing map coverage rather than guaranteed market demand.`,
      promisingZones: [
        'All active Nanded City zones currently show 0 returned listings—perform an on-ground footfall and residential cluster check before deciding.',
      ],
      competitionHotspots: ['No concentrated competition hotspots were detected in the retrieved listings.'],
      nextSteps: [
        'Visit main commercial complexes inside Nanded City (e.g., Destination Centre / main spine roads) to verify unlisted shops.',
        'Check rent rates and residential tower occupancy nearby.',
      ],
      dataCaveats:
        'Generated locally as a fallback because the Claude AI backend was unreachable. Results reflect Google Places listings only, not a complete physical census.',
    }
  }

  return {
    isFallback: true,
    summary: `Across the ~${summary.totalAreaKm2} km² study boundary, ${summary.totalBusinesses} unique ${categoryLabel.toLowerCase()} listings were retrieved (${summary.overallDensity} per km²). Overall competition indicator is ${summary.competitionLevel}.`,
    promisingZones:
      lowZones.length > 0
        ? lowZones.slice(0, 3).map(
            (z) =>
              `${z.name} (${z.direction}): ${z.count} listing(s), ${z.density}/km², preliminary indicator ${z.opportunityScore}/100 — worth field investigation for unmet local convenience.`,
          )
        : ['No zero/low-presence zones were found; competition appears spread across sectors.'],
    competitionHotspots:
      highZones.length > 0
        ? highZones.map(
            (z) =>
              `${z.name} (${z.direction}): ${z.count} listings (${z.density}/km²) — higher concentration of existing competitors.`,
          )
        : [
            summary.highestZone
              ? `${summary.highestZone.name} (${summary.highestZone.direction}) has the highest observed count (${summary.highestZone.count} listings).`
              : 'No sharp hotspot detected.',
          ],
    nextSteps: [
      'Conduct physical walk-throughs in the green (Low Presence) zones to check residential footfall and unlisted competitors.',
      'Compare shop rental cost and parking access between Low and Medium presence zones.',
    ],
    dataCaveats:
      'Generated locally using rule-based analysis (connect the Express + Claude AI backend for full AI reasoning). Google Places data may omit newly opened or unlisted shops, and demand/income data is not included.',
  }
}

function App() {
  const [selectedCategory, setSelectedCategory] = useState('pharmacy')
  const [analyzedCategory, setAnalyzedCategory] = useState('')
  const [analysisRunId, setAnalysisRunId] = useState(0)

  const [mapReady, setMapReady] = useState(false)
  const [loadingStep, setLoadingStep] = useState(0)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const [analysis, setAnalysis] = useState(null)
  const [selectedZoneId, setSelectedZoneId] = useState(null)
  const [metricsScope, setMetricsScope] = useState('overall') // 'overall' | 'zone'
  const [activeInspectorTab, setActiveInspectorTab] = useState('zones')
  const [businessSearch, setBusinessSearch] = useState('')

  const [showZones, setShowZones] = useState(true)
  const [showMarkers, setShowMarkers] = useState(true)
  const [showBoundary, setShowBoundary] = useState(true)

  const [aiReport, setAiReport] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)

  const studyAreaKm2 = Number(calculateAreaKm2(NANDED_CITY_BOUNDARY).toFixed(2))

  const fetchClaudeRecommendation = useCallback(async (categoryId, computedAnalysis) => {
    setAiLoading(true)
    try {
      const payload = {
        category: categoryId,
        categoryLabel: getCategoryLabel(categoryId),
        studyAreaKm2: computedAnalysis.summary.totalAreaKm2,
        totalBusinesses: computedAnalysis.summary.totalBusinesses,
        overallDensity: computedAnalysis.summary.overallDensity,
        avgPerZone: computedAnalysis.summary.avgPerZone,
        competitionLevel: computedAnalysis.summary.competitionLevel,
        preliminaryStudyScore: computedAnalysis.summary.preliminaryStudyScore,
        zones: computedAnalysis.zones.map((z) => ({
          id: z.id,
          name: z.name,
          direction: z.direction,
          areaKm2: z.areaKm2,
          count: z.count,
          density: z.density,
          presenceLevel: z.presenceLevel,
          opportunityScore: z.opportunityScore,
        })),
      }

      const res = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Backend responded with ${res.status}`)
      }

      const data = await res.json()
      setAiReport({ ...data, isFallback: false })
    } catch (err) {
      console.warn('Claude AI backend fallback activated:', err.message)
      setAiReport(buildFallbackRecommendation(getCategoryLabel(categoryId), computedAnalysis))
    } finally {
      setAiLoading(false)
    }
  }, [])

  function handleAnalyze() {
    if (!selectedCategory) {
      setErrorMsg('Please select a business category first.')
      return
    }
    if (!mapReady) {
      setErrorMsg('Google Maps is still initializing. Please wait a moment.')
      return
    }

    setErrorMsg('')
    setAiReport(null)
    setSelectedZoneId(null)
    setMetricsScope('overall')
    setBusinessSearch('')
    setIsAnalyzing(true)
    setLoadingStep(1)
    setAnalyzedCategory(selectedCategory)
    setAnalysisRunId((prev) => prev + 1)
  }

  const handlePlacesFound = useCallback(
    async (uniquePlaces) => {
      setLoadingStep(3)
      const computed = analyzeZonesAndScore(uniquePlaces, NANDED_CITY_BOUNDARY)
      setAnalysis(computed)

      if (computed.summary.topOpportunityZone) {
        setSelectedZoneId(computed.summary.topOpportunityZone.id)
      }

      setLoadingStep(4)
      await fetchClaudeRecommendation(selectedCategory, computed)

      setIsAnalyzing(false)
      setLoadingStep(0)
    },
    [selectedCategory, fetchClaudeRecommendation],
  )

  const handleAnalysisError = useCallback((message) => {
    setIsAnalyzing(false)
    setLoadingStep(0)
    setErrorMsg(message)
  }, [])

  const handleChooseZone = useCallback((zoneId) => {
    setSelectedZoneId(zoneId)
    setMetricsScope('zone')
  }, [])

  const selectedZone =
    analysis?.zones.find((z) => z.id === selectedZoneId) || analysis?.zones[0] || null

  const zoneRank = useMemo(() => {
    if (!analysis || !selectedZone) return null
    const sorted = [...analysis.zones].sort(
      (a, b) => (b.opportunityScore ?? -1) - (a.opportunityScore ?? -1) || a.count - b.count,
    )
    const idx = sorted.findIndex((z) => z.id === selectedZone.id)
    return idx >= 0 ? idx + 1 : null
  }, [analysis, selectedZone])

  const filteredBusinesses = (analysis?.places || []).filter((p) => {
    const q = businessSearch.trim().toLowerCase()
    if (!q) return true
    return (
      p.name.toLowerCase().includes(q) ||
      p.address.toLowerCase().includes(q) ||
      (p.zoneLabel || '').toLowerCase().includes(q)
    )
  })

  const analyzedLabel = analyzedCategory ? getCategoryLabel(analyzedCategory) : ''

  // Zone-specific comparison helpers
  const zoneSharePct =
    analysis && selectedZone && analysis.summary.totalBusinesses > 0
      ? ((selectedZone.count / analysis.summary.totalBusinesses) * 100).toFixed(1)
      : '0.0'

  const diffFromAvg =
    analysis && selectedZone
      ? Number((selectedZone.count - analysis.summary.avgPerZone).toFixed(2))
      : 0

  const diffFromAvgLabel =
    diffFromAvg > 0
      ? `+${diffFromAvg} above avg`
      : diffFromAvg < 0
        ? `${diffFromAvg} below avg`
        : 'Matches study avg'

  return (
    <div className="app">
      <AnalysisLoadingModal
        active={isAnalyzing}
        currentStep={loadingStep}
        categoryLabel={getCategoryLabel(selectedCategory)}
      />

      {/* Top Navigation */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-icon" aria-hidden="true">
              📍
            </div>
            <div>
              <div className="brand-title-row">
                <h1>Nanded Shop Analyzer</h1>
                <span className="region-pill">Nanded City, Pune</span>
              </div>
              <p>
                AI-powered spatial market &amp; zone opportunity intelligence (~{studyAreaKm2} km²
                study area)
              </p>
            </div>
          </div>

          <div className="topbar-actions">
            <button
              className="analyze-btn"
              onClick={handleAnalyze}
              disabled={!mapReady || isAnalyzing}
            >
              {isAnalyzing ? 'Analyzing...' : 'Analyze Nanded'}
            </button>
          </div>
        </div>
      </header>

      <main className="dashboard">
        {/* Category Selector Bar */}
        <section className="control-panel card">
          <div className="control-header">
            <div>
              <span className="section-eyebrow">Step 1 • Select Target Business</span>
              <h2>Choose a Retail or Service Category</h2>
            </div>
            {analyzedLabel && (
              <span className="status-chip">
                Showing: <strong>{analyzedLabel}</strong>
              </span>
            )}
          </div>

          <div className="category-pills" role="group" aria-label="Business categories">
            {BUSINESS_CATEGORIES.map((cat) => {
              const active = selectedCategory === cat.id
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`cat-pill ${active ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat.id)}
                >
                  <span>{CATEGORY_ICONS[cat.id]}</span>
                  <span>{cat.label}</span>
                </button>
              )
            })}
          </div>
        </section>

        {errorMsg && (
          <div className="alert-banner error" role="alert">
            <strong>Notice:</strong> {errorMsg}
          </div>
        )}

        {/* Map + Interactive Inspector Workspace */}
        <section className="workspace-grid">
          <div className="map-card card">
            <div className="map-toolbar">
              <div className="map-title">
                <h3>Geospatial Distribution &amp; Zones</h3>
                <small>Click any zone polygon or pin to inspect zone-specific metrics</small>
              </div>
              <div className="layer-toggles">
                <label className="toggle-pill">
                  <input
                    type="checkbox"
                    checked={showZones}
                    onChange={(e) => setShowZones(e.target.checked)}
                  />
                  <span>Zones</span>
                </label>
                <label className="toggle-pill">
                  <input
                    type="checkbox"
                    checked={showMarkers}
                    onChange={(e) => setShowMarkers(e.target.checked)}
                  />
                  <span>Markers</span>
                </label>
                <label className="toggle-pill">
                  <input
                    type="checkbox"
                    checked={showBoundary}
                    onChange={(e) => setShowBoundary(e.target.checked)}
                  />
                  <span>Boundary</span>
                </label>
              </div>
            </div>

            <div className="map-container">
              <Map
                category={analyzedCategory}
                analysisRunId={analysisRunId}
                zones={analysis?.zones || []}
                selectedZoneId={selectedZoneId}
                showZones={showZones}
                showMarkers={showMarkers}
                showBoundary={showBoundary}
                onMapReady={setMapReady}
                onStepChange={setLoadingStep}
                onPlacesFound={handlePlacesFound}
                onAnalysisError={handleAnalysisError}
                onSelectZone={(id) => {
                  handleChooseZone(id)
                  setActiveInspectorTab('zones')
                }}
              />

              {/* Floating Map Legend */}
              <div className="map-legend">
                <div className="legend-title">Zone Business Presence</div>
                <div className="legend-items">
                  <span>
                    <i className="dot low" /> Low (Underserved Candidate)
                  </span>
                  <span>
                    <i className="dot medium" /> Medium
                  </span>
                  <span>
                    <i className="dot high" /> High (Competition)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side Inspector */}
          <aside className="inspector-card card">
            <div className="inspector-tabs">
              <button
                type="button"
                className={activeInspectorTab === 'zones' ? 'active' : ''}
                onClick={() => setActiveInspectorTab('zones')}
              >
                Zone Breakdown ({analysis?.zones.length || 0})
              </button>
              <button
                type="button"
                className={activeInspectorTab === 'directory' ? 'active' : ''}
                onClick={() => setActiveInspectorTab('directory')}
              >
                Businesses ({analysis?.places.length || 0})
              </button>
            </div>

            {!analysis ? (
              <div className="inspector-empty">
                <div className="empty-icon">🗺️</div>
                <h4>Ready to Analyze</h4>
                <p>
                  Select any business category above and click <strong>Analyze Nanded</strong> to
                  divide the study area into zones, map competitors, and inspect opportunities.
                </p>
              </div>
            ) : activeInspectorTab === 'zones' ? (
              <div className="zone-inspector">
                {selectedZone && (
                  <div className="selected-zone-box">
                    <div className="zone-box-header">
                      <div>
                        <span className="zone-tag">{selectedZone.id}</span>
                        <h4>
                          {selectedZone.name} • {selectedZone.direction}
                        </h4>
                      </div>
                      <span className={`presence-badge ${selectedZone.presenceLevel.toLowerCase()}`}>
                        {selectedZone.presenceLevel} Presence
                      </span>
                    </div>

                    <div className="zone-mini-metrics">
                      <div>
                        <small>Businesses</small>
                        <strong>{selectedZone.count}</strong>
                      </div>
                      <div>
                        <small>Zone Area</small>
                        <strong>{selectedZone.areaKm2} km²</strong>
                      </div>
                      <div>
                        <small>Density</small>
                        <strong>{selectedZone.density}/km²</strong>
                      </div>
                      <div>
                        <small>Prelim. Score</small>
                        <strong>
                          {selectedZone.opportunityScore !== null
                            ? `${selectedZone.opportunityScore}/100`
                            : 'N/A'}
                        </strong>
                      </div>
                    </div>

                    {selectedZone.scoreBreakdown && (
                      <div className="score-breakdown">
                        <small>
                          Score Factors: Supply Gap {selectedZone.scoreBreakdown.supplyGap}% •
                          Density Relief {selectedZone.scoreBreakdown.densityRelief}% • Neighbor
                          Relief {selectedZone.scoreBreakdown.neighborRelief}%
                        </small>
                      </div>
                    )}
                  </div>
                )}

                <div className="zone-list">
                  {analysis.zones.map((zone) => {
                    const isSelected = zone.id === selectedZone?.id
                    return (
                      <button
                        key={zone.id}
                        type="button"
                        className={`zone-row ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleChooseZone(zone.id)}
                      >
                        <div className="zone-row-left">
                          <span className={`zone-dot ${zone.presenceLevel.toLowerCase()}`} />
                          <div>
                            <strong>
                              {zone.name} ({zone.direction})
                            </strong>
                            <small>
                              {zone.count} found • {zone.density}/km²
                            </small>
                          </div>
                        </div>
                        <div className="zone-row-right">
                          {isSelected && <span className="inspecting-pill">Selected</span>}
                          <span className="zone-score-pill">
                            {zone.opportunityScore !== null ? `${zone.opportunityScore}/100` : '—'}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="directory-inspector">
                <input
                  type="search"
                  className="directory-search"
                  placeholder="Filter businesses by name, address, or zone..."
                  value={businessSearch}
                  onChange={(e) => setBusinessSearch(e.target.value)}
                />
                {filteredBusinesses.length === 0 ? (
                  <p className="empty-list-msg">No matching businesses inside the study boundary.</p>
                ) : (
                  <div className="business-list">
                    {filteredBusinesses.map((place) => (
                      <div key={place.id} className="business-item">
                        <div className="business-top">
                          <strong>{place.name}</strong>
                          <span className="zone-mini-tag">{place.zoneId}</span>
                        </div>
                        <p>{place.address}</p>
                        {place.rating && (
                          <small>
                            ★ {place.rating}
                            {place.userRatingCount ? ` (${place.userRatingCount} reviews)` : ''}
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </aside>
        </section>

        {/* KPI Market Analysis Dashboard (Supports Overall AND Specific Zone View) */}
        {analysis && (
          <>
            <section className="kpi-section">
              <div className="section-title-row">
                <div>
                  <h2>
                    {metricsScope === 'zone' && selectedZone
                      ? `Zone Analysis: ${selectedZone.name} (${selectedZone.direction}) — ${analyzedLabel}`
                      : `Market & Spatial Metrics — ${analyzedLabel}`}
                  </h2>
                  <span className="honesty-note">
                    {metricsScope === 'zone' && selectedZone
                      ? `Showing specific metrics for ${selectedZone.id} (${selectedZone.areaKm2} km²) compared against all ${analysis.summary.activeZoneCount} zones`
                      : `Based on ${analysis.summary.totalBusinesses} retrieved Google Places listings inside the approximate boundary`}
                  </span>
                </div>

                {/* Scope Toggle + Quick Zone Selector */}
                <div className="scope-controls">
                  <div className="scope-switcher" role="group" aria-label="Metrics scope">
                    <button
                      type="button"
                      className={`scope-btn ${metricsScope === 'overall' ? 'active' : ''}`}
                      onClick={() => setMetricsScope('overall')}
                    >
                      Overall Nanded City
                    </button>
                    <button
                      type="button"
                      className={`scope-btn ${metricsScope === 'zone' ? 'active' : ''}`}
                      onClick={() => setMetricsScope('zone')}
                    >
                      {selectedZone ? `${selectedZone.name} (${selectedZone.id})` : 'Selected Zone'}
                    </button>
                  </div>

                  <div className="zone-quick-pills" aria-label="Select specific zone">
                    {analysis.zones.map((z) => (
                      <button
                        key={z.id}
                        type="button"
                        title={`${z.name} (${z.direction})`}
                        className={`zone-pill-btn ${
                          metricsScope === 'zone' && selectedZone?.id === z.id ? 'active' : ''
                        }`}
                        onClick={() => handleChooseZone(z.id)}
                      >
                        {z.id}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {metricsScope === 'overall' ? (
                <div className="kpi-grid">
                  <div className="kpi-card card">
                    <span>Unique Businesses Found</span>
                    <strong>{analysis.summary.totalBusinesses}</strong>
                    <small>Deduplicated across 5 search sectors</small>
                  </div>

                  <div className="kpi-card card">
                    <span>Overall Observed Density</span>
                    <strong>{analysis.summary.overallDensity}</strong>
                    <small>Listings per km² (Area: {analysis.summary.totalAreaKm2} km²)</small>
                  </div>

                  <div className="kpi-card card">
                    <span>Avg. Businesses / Zone</span>
                    <strong>{analysis.summary.avgPerZone}</strong>
                    <small>Across {analysis.summary.activeZoneCount} active geographical zones</small>
                  </div>

                  <div className="kpi-card card">
                    <span>Competition Indicator</span>
                    <strong className={`text-${analysis.summary.competitionLevel.toLowerCase()}`}>
                      {analysis.summary.competitionLevel}
                    </strong>
                    <small>
                      {analysis.summary.highestZone
                        ? `Peak: ${analysis.summary.highestZone.name} (${analysis.summary.highestZone.count})`
                        : 'No peak hotspot'}
                    </small>
                  </div>

                  <div className="kpi-card card highlight">
                    <span>Top Opportunity Zone</span>
                    <strong>
                      {analysis.summary.topOpportunityZone
                        ? `${analysis.summary.topOpportunityZone.name} (${analysis.summary.topOpportunityZone.direction})`
                        : 'Insufficient Data'}
                    </strong>
                    <small>
                      {analysis.summary.topOpportunityZone
                        ? `Preliminary indicator: ${analysis.summary.topOpportunityZone.opportunityScore}/100`
                        : '0 listings retrieved'}
                    </small>
                  </div>

                  <div className="kpi-card card">
                    <span>Study-Area Opportunity Avg</span>
                    <strong>
                      {analysis.summary.preliminaryStudyScore !== null
                        ? `${analysis.summary.preliminaryStudyScore}/100`
                        : 'N/A'}
                    </strong>
                    <small>Preliminary supply-side heuristic</small>
                  </div>
                </div>
              ) : (
                selectedZone && (
                  <>
                    <div className="kpi-grid">
                      <div className="kpi-card card">
                        <span>Businesses in {selectedZone.name}</span>
                        <strong>{selectedZone.count}</strong>
                        <small>
                          {zoneSharePct}% of all {analysis.summary.totalBusinesses} Nanded City
                          listings
                        </small>
                      </div>

                      <div className="kpi-card card">
                        <span>{selectedZone.id} Observed Density</span>
                        <strong>{selectedZone.density} / km²</strong>
                        <small>
                          Study avg: {analysis.summary.overallDensity}/km² • Area:{' '}
                          {selectedZone.areaKm2} km²
                        </small>
                      </div>

                      <div className="kpi-card card">
                        <span>Compared to Zone Average</span>
                        <strong
                          className={
                            diffFromAvg > 0
                              ? 'text-high'
                              : diffFromAvg < 0
                                ? 'text-low'
                                : 'text-medium'
                          }
                        >
                          {diffFromAvgLabel}
                        </strong>
                        <small>Study avg per zone: {analysis.summary.avgPerZone}</small>
                      </div>

                      <div className="kpi-card card">
                        <span>{selectedZone.id} Presence Level</span>
                        <strong className={`text-${selectedZone.presenceLevel.toLowerCase()}`}>
                          {selectedZone.presenceLevel}
                        </strong>
                        <small>
                          Neighbor avg:{' '}
                          {selectedZone.scoreBreakdown?.avgNeighborCount ?? '—'} listings
                        </small>
                      </div>

                      <div className="kpi-card card highlight">
                        <span>{selectedZone.id} Opportunity Score</span>
                        <strong>
                          {selectedZone.opportunityScore !== null
                            ? `${selectedZone.opportunityScore}/100`
                            : 'N/A'}
                        </strong>
                        <small>
                          {selectedZone.scoreBreakdown
                            ? `Gap ${selectedZone.scoreBreakdown.supplyGap}% • Density ${selectedZone.scoreBreakdown.densityRelief}% • Neighbor ${selectedZone.scoreBreakdown.neighborRelief}%`
                            : 'Insufficient listings to score'}
                        </small>
                      </div>

                      <div className="kpi-card card">
                        <span>Zone Opportunity Rank</span>
                        <strong>
                          #{zoneRank} of {analysis.summary.activeZoneCount}
                        </strong>
                        <small>{selectedZone.direction} sector</small>
                      </div>
                    </div>

                    {/* Zone-Specific Insight + Local Businesses inside that Zone */}
                    <div className="zone-detail-strip card">
                      <div className="zone-detail-header">
                        <div>
                          <h3>
                            Inside {selectedZone.name} ({selectedZone.direction}) —{' '}
                            {selectedZone.places.length} {analyzedLabel} Listing(s)
                          </h3>
                          <p>
                            {selectedZone.presenceLevel === 'Low'
                              ? `Relatively low listed presence (${selectedZone.count} found vs. ${analysis.summary.avgPerZone} zone average). Worth an on-site check for residential demand, footfall, and shop availability.`
                              : selectedZone.presenceLevel === 'Medium'
                                ? `Moderate competition (${selectedZone.count} found). A differentiated offering or strong storefront location would be important here.`
                                : `High concentration (${selectedZone.count} found, ${selectedZone.density}/km²). Expect strong existing competition in this sector.`}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="refresh-ai-btn"
                          onClick={() => setMetricsScope('overall')}
                        >
                          ← Back to Overall Nanded City
                        </button>
                      </div>

                      {selectedZone.places.length === 0 ? (
                        <div className="zone-empty-places">
                          No Google Places listings for <strong>{analyzedLabel}</strong> fell inside{' '}
                          {selectedZone.name}. Verify physically whether residential occupancy or
                          unlisted shops exist here.
                        </div>
                      ) : (
                        <div className="zone-businesses-grid">
                          {selectedZone.places.map((place) => (
                            <div key={place.id} className="business-item">
                              <div className="business-top">
                                <strong>{place.name}</strong>
                                <span className="zone-mini-tag">{selectedZone.id}</span>
                              </div>
                              <p>{place.address}</p>
                              {place.rating && (
                                <small>
                                  ★ {place.rating}
                                  {place.userRatingCount
                                    ? ` (${place.userRatingCount} reviews)`
                                    : ''}
                                </small>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )
              )}
            </section>

            {/* Claude AI Recommendations Panel */}
            <section className="ai-panel card">
              <div className="ai-header">
                <div>
                  <span className="ai-badge">
                    {aiReport?.isFallback
                      ? 'Rule-Based Fallback Summary'
                      : 'Claude AI Location Advisor'}
                  </span>
                  <h2>AI Business-Location Recommendations</h2>
                </div>
                <button
                  type="button"
                  className="refresh-ai-btn"
                  disabled={aiLoading}
                  onClick={() => fetchClaudeRecommendation(analyzedCategory, analysis)}
                >
                  {aiLoading ? 'Generating...' : 'Regenerate AI Insight'}
                </button>
              </div>

              {aiLoading ? (
                <div className="ai-skeleton">
                  <div className="skeleton-line wide" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line short" />
                </div>
              ) : aiReport ? (
                <div className="ai-content">
                  <p className="ai-summary">{aiReport.summary}</p>

                  <div className="ai-columns">
                    <div className="ai-box green">
                      <h3>Promising Zones to Investigate</h3>
                      <ul>
                        {(aiReport.promisingZones || []).map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="ai-box amber">
                      <h3>Competition Hotspots</h3>
                      <ul>
                        {(aiReport.competitionHotspots || []).map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {aiReport.nextSteps?.length > 0 && (
                    <div className="ai-next-steps">
                      <h3>Recommended Field Verification Steps</h3>
                      <ul>
                        {aiReport.nextSteps.map((step, idx) => (
                          <li key={idx}>{step}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="ai-caveat">
                    <strong>Data Scope &amp; Limitations:</strong> {aiReport.dataCaveats}
                  </div>
                </div>
              ) : null}
            </section>
          </>
        )}

        {/* Transparent Methodology Card */}
        <section className="methodology card">
          <h3>Methodology, Opportunity Formula &amp; Academic Disclaimers</h3>
          <div className="methodology-grid">
            <div>
              <h4>Preliminary Opportunity Indicator Formula (0–100)</h4>
              <p>
                Each zone score combines three normalized supply-side factors:
                <strong> 50% Local Supply Gap</strong> (fewer same-category listings than the
                busiest zone), <strong>30% Density Relief</strong> (lower listings/km²), and
                <strong> 20% Neighbor Competition Relief</strong> (average listings in adjacent
                zones).
              </p>
            </div>
            <div>
              <h4>Important Project Limitations</h4>
              <p>
                1. The boundary polygon is an approximate academic prototype for Nanded City, Pune.
                2. Google Places API returns available map listings, not a complete government
                census. 3. Low business presence indicates fewer listed competitors—not guaranteed
                customer demand, footfall, or rental affordability.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>
          Nanded Shop Analyzer • Engineering PBL Location Intelligence Dashboard (Nanded City, Pune)
        </p>
      </footer>
    </div>
  )
}

export default App