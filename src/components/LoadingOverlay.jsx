const ANALYSIS_STEPS = [
  { id: 1, title: 'Scanning Nanded City Sectors', desc: 'Querying Google Places across multiple zones...' },
  { id: 2, title: 'Filtering & Deduplicating', desc: 'Applying study-boundary polygon filter...' },
  { id: 3, title: 'Zone Division & Scoring', desc: 'Calculating zone densities & preliminary indicators...' },
  { id: 4, title: 'Claude AI Interpretation', desc: 'Generating structured location recommendations...' },
]

export function MapBootLoader() {
  return (
    <div className="map-boot-overlay" role="status" aria-live="polite">
      <div className="boot-card">
        <div className="spinner-ring" />
        <h3>Initializing Nanded City Spatial Engine</h3>
        <p>Loading Google Maps &amp; Places intelligence layers...</p>
      </div>
    </div>
  )
}

export function AnalysisLoadingModal({ active, currentStep, categoryLabel }) {
  if (!active) return null

  const progressPct = Math.min(100, Math.max(15, (currentStep / ANALYSIS_STEPS.length) * 100))

  return (
    <div className="analysis-loader-backdrop" role="status" aria-live="polite">
      <div className="analysis-loader-card">
        <div className="loader-top">
          <div className="pulse-badge">
            <span className="pulse-dot" />
            Live Spatial Pipeline
          </div>
          <span className="step-counter">
            Step {currentStep} of {ANALYSIS_STEPS.length}
          </span>
        </div>

        <h3>Analyzing {categoryLabel} Market in Nanded City</h3>
        <p className="loader-subtitle">
          Collecting Places listings, segmenting zones, and computing preliminary indicators.
        </p>

        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>

        <ul className="pipeline-steps">
          {ANALYSIS_STEPS.map((step) => {
            const isDone = currentStep > step.id
            const isActive = currentStep === step.id
            return (
              <li
                key={step.id}
                className={`pipeline-step ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}
              >
                <span className="step-indicator">
                  {isDone ? '✓' : isActive ? <span className="mini-spinner" /> : step.id}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <small>{step.desc}</small>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
