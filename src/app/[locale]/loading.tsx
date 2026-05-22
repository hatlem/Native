// Skeleton loading state for [locale] routes. Renders the shape of a
// typical page so navigation feels instant while server work completes.
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="page-header">
        <div className="skel skel-eyebrow" />
        <div className="skel skel-h1" />
        <div className="skel skel-lead" />
      </div>
      <div className="kpi-grid">
        <div className="kpi skel-kpi">
          <div className="skel skel-line" />
          <div className="skel skel-value" />
          <div className="skel skel-line short" />
        </div>
        <div className="kpi skel-kpi">
          <div className="skel skel-line" />
          <div className="skel skel-value" />
          <div className="skel skel-line short" />
        </div>
        <div className="kpi skel-kpi">
          <div className="skel skel-line" />
          <div className="skel skel-value" />
          <div className="skel skel-line short" />
        </div>
      </div>
      <div className="grid" style={{ marginTop: 32 }}>
        <div className="card skel-card">
          <div className="skel skel-line" />
          <div className="skel skel-line short" />
          <div className="skel skel-line" />
        </div>
        <div className="card skel-card">
          <div className="skel skel-line" />
          <div className="skel skel-line short" />
          <div className="skel skel-line" />
        </div>
        <div className="card skel-card">
          <div className="skel skel-line" />
          <div className="skel skel-line short" />
          <div className="skel skel-line" />
        </div>
      </div>
    </div>
  );
}
