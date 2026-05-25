import { getLocale } from "next-intl/server";
import { LandingShell } from "@/app/landing-shell";

// Marketing-route loading state. Renders inside the Bone shell so the
// editorial palette is on screen the moment a public page starts to
// resolve, instead of flashing the generic app-shell skeleton first.
export default async function MarketingLoading() {
  const locale = await getLocale();

  return (
    <LandingShell
      locale={locale}
      screenLabel="Loading"
      withFooter={false}
    >
      <div aria-busy="true" aria-live="polite" className="page-hero">
        <div className="wrap">
          <span className="skel skel-eyebrow" />
          <span className="skel skel-h1" />
          <span className="skel skel-lead" />
        </div>
      </div>
      <section className="section">
        <div className="wrap">
          <div className="grid" style={{ borderTop: "2px solid var(--rule)" }}>
            <article className="card">
              <span className="skel skel-line" />
              <span className="skel skel-line short" />
              <span className="skel skel-line" />
            </article>
            <article className="card">
              <span className="skel skel-line" />
              <span className="skel skel-line short" />
              <span className="skel skel-line" />
            </article>
            <article className="card">
              <span className="skel skel-line" />
              <span className="skel skel-line short" />
              <span className="skel skel-line" />
            </article>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
