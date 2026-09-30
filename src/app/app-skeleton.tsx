// Skeleton of a typical app page (header, KPI row, cards), shown by the
// loading.tsx of data-heavy leaf pages while their server work completes.
//
// Deliberately NOT a [locale]-wide loading.tsx: a loading boundary wraps
// every page beneath it in Suspense, so the 200 shell streams before the page
// runs — and every notFound() / redirect() below it degraded to a soft 404
// (HTTP 200) or a meta-refresh redirect. Keep loading boundaries on pages
// that neither 404 nor redirect, and never above a detail route.
export function AppSkeleton() {
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
