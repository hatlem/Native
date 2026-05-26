// Shared editorial "Bone" design system used by every public marketing page.
// Loaded once per page via <LandingShell> as a nonce'd <style> block so the
// strict CSP from middleware.ts allows it.
//
// The CSS is namespaced under `.bn` so it cannot collide with the
// signed-in app shell, the desk console, or the publisher portal. Keep
// new primitives namespaced the same way.

export const STYLES = `
/* Keep the locale layout's site mega menu; reset main padding & hide the layout footer (landing has its own). */
body:has(.bn) > footer { display: none !important; }
body:has(.bn) main.container {
  max-width: none !important;
  padding: 0 !important;
  margin: 0 !important;
}

/* Reconcile the public mega header with the bone landing palette.
   The header is rendered by PublicHeader (.nav-mega-link / .nav-mega-trigger /
   .btn / .icon-btn) outside the .bn wrapper, so the .bn token overrides
   don't reach it — we restate the cream palette explicitly. */
body:has(.bn) header.site-header {
  background: rgba(237, 232, 219, 0.92) !important;
  border-bottom: 2px solid #14110C !important;
  color-scheme: light;
}
body:has(.bn) header.site-header .brand,
body:has(.bn) header.site-header .brand:hover { color: #14110C !important; }
body:has(.bn) header.site-header .brand-mark {
  background: #14110C !important;
  color: #EDE8DB !important;
}
body:has(.bn) header.site-header .nav-mega-link,
body:has(.bn) header.site-header .nav-mega-trigger {
  color: #3A3528 !important;
  background: transparent !important;
}
body:has(.bn) header.site-header .nav-mega-link:hover,
body:has(.bn) header.site-header .nav-mega-trigger:hover,
body:has(.bn) header.site-header .nav-mega-trigger[aria-expanded="true"],
body:has(.bn) header.site-header .nav-mega-link[aria-current="page"] {
  color: #14110C !important;
  background: rgba(20,17,12,0.06) !important;
}
/* Mega dropdown panel — cream surface, ink content */
body:has(.bn) .mega-panel {
  background: #EDE8DB !important;
  border: 1px solid rgba(20,17,12,0.18) !important;
  box-shadow: 6px 6px 0 0 rgba(20,17,12,0.18) !important;
}
body:has(.bn) .mega-item { color: #14110C !important; }
body:has(.bn) .mega-item:hover { background: rgba(20,17,12,0.06) !important; }
body:has(.bn) .mega-item-icon { color: #6B6452 !important; }
body:has(.bn) .mega-item-title { color: #14110C !important; }
body:has(.bn) .mega-item-desc { color: #6B6452 !important; }
body:has(.bn) .mega-featured {
  background: rgba(20,17,12,0.04) !important;
  border-top: 1px solid rgba(20,17,12,0.12) !important;
}
body:has(.bn) .mega-featured-icon { color: #14110C !important; }
body:has(.bn) .mega-featured-title { color: #14110C !important; }
body:has(.bn) .mega-featured-desc { color: #6B6452 !important; }
/* Header action buttons — Sign in (ghost) + Sign up (filled) */
body:has(.bn) header.site-header .nav-actions .btn {
  border: 2px solid #14110C !important;
  border-radius: 2px !important;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 600;
}
body:has(.bn) header.site-header .nav-actions .btn.ghost {
  background: transparent !important;
  color: #14110C !important;
}
body:has(.bn) header.site-header .nav-actions .btn.ghost:hover {
  background: rgba(20,17,12,0.06) !important;
}
body:has(.bn) header.site-header .nav-actions .btn:not(.ghost) {
  background: #14110C !important;
  color: #EDE8DB !important;
}
body:has(.bn) header.site-header .nav-actions .btn:not(.ghost):hover {
  background: #3A3528 !important;
  border-color: #3A3528 !important;
}
body:has(.bn) header.site-header .icon-btn {
  color: #14110C !important;
  background: transparent !important;
  border: 1px solid rgba(20,17,12,0.32) !important;
}
body:has(.bn) header.site-header .icon-btn:hover {
  background: rgba(20,17,12,0.06) !important;
}
/* Mobile drawer — cream sheet */
body:has(.bn) .drawer .sheet {
  background: #EDE8DB !important;
  color: #14110C !important;
  color-scheme: light;
}
body:has(.bn) .drawer .scrim { background: rgba(20,17,12,0.4) !important; }
body:has(.bn) .drawer-link {
  color: #14110C !important;
  border-bottom-color: rgba(20,17,12,0.12) !important;
}
body:has(.bn) .drawer-link:hover { background: rgba(20,17,12,0.06) !important; }

.bn {
  /* Lock the editorial cream palette regardless of OS prefers-color-scheme.
     globals.css flips --heading/--text/--muted to near-white in dark mode,
     which would render unreadable on the cream paper background. */
  color-scheme: light;
  --paper: #EDE8DB;
  --paper-2: #E4DECB;
  --ink: #14110C;
  --ink-soft: #3A3528;
  --ink-mute: #6B6452;
  --rule: #14110C;
  --hair: rgba(20,17,12,.18);
  --accent: #14110C;
  /* Override the globals.css dark-mode tokens so any element that still
     reads --heading/--text/--muted (h1/h2/h3, .lead, .muted) stays dark
     ink on cream. */
  --heading: #14110C;
  --text: #14110C;
  --muted: #6B6452;
  --muted-strong: #3A3528;
  --bg: #EDE8DB;
  --surface: #EDE8DB;
  --surface-2: #E4DECB;
  --border: rgba(20,17,12,.18);
  --border-strong: rgba(20,17,12,.32);
  --primary: #14110C;
  --primary-hover: #3A3528;
  --primary-contrast: #EDE8DB;
  --ok: #1F6F3E;
  --info: #3A3528;
  --warn: #8B5A00;
  --NO: #BA0C2F;
  --SE: #006AA7;
  --DK: #C8102E;
  --FI: #003580;
  --DE: #1a1a1a;
  --AT: #ED2939;
  --CH: #DA291C;
  --UK: #012169;
  --IE: #009A44;
  --max: 1280px;
  --pad: clamp(20px, 4vw, 56px);

  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-inter), -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  font-feature-settings: "ss01" 1, "cv11" 1;
  font-weight: 400;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.bn, .bn * { box-sizing: border-box; }
.bn a { color: inherit; text-decoration: none; }
.bn ::selection { background: var(--ink); color: var(--paper); }

.bn .wrap { max-width: var(--max); margin: 0 auto; padding-left: var(--pad); padding-right: var(--pad); }

/* — Shared label / eyebrow — */
.bn .label,
.bn .eyebrow {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600;
  color: var(--ink);
}
.bn .eyebrow.accent { color: var(--ink); }
.bn .eyebrow.muted { color: var(--ink-mute); }
.bn .lead {
  font-size: clamp(15px, 1.2vw, 17px); line-height: 1.55; color: var(--ink-soft); max-width: 60ch;
}
.bn .muted { color: var(--ink-mute); }
.bn .link {
  border-bottom: 1px solid var(--ink); padding-bottom: 1px;
  font-weight: 500;
  transition: opacity .15s ease;
}
.bn .link:hover { opacity: .7; }
.bn .small { font-size: 12px; }

/* — Hero — homepage editorial hero */
.bn .hero {
  padding: clamp(28px, 3.6vw, 56px) 0 clamp(28px, 3.6vw, 56px);
  border-bottom: 2px solid var(--rule);
}
.bn .pain-row {
  display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap;
  margin-bottom: clamp(20px, 2.4vw, 36px);
}
.bn .pain-row .label::after {
  content: ""; display: inline-block; width: 56px; height: 1px; background: var(--ink); margin-left: 16px; transform: translateY(-4px);
}
.bn .pain-line {
  font-size: clamp(14px, 1.1vw, 16px);
  color: var(--ink-soft);
  max-width: 64ch;
  line-height: 1.5;
  margin: 0;
}
.bn .pain-line strong { font-weight: 600; color: var(--ink); }

.bn h1.headline {
  font-weight: 600;
  font-size: clamp(40px, min(6.4vw, 8.4vh), 88px);
  line-height: 0.95;
  letter-spacing: -0.045em;
  margin: 0 0 clamp(24px, 2.6vw, 40px) 0;
  text-wrap: balance;
}
.bn h1.headline .row { display: block; }
.bn h1.headline .ink-mute { color: var(--ink-mute); }

.bn .hero-cluster {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: clamp(32px, 5vw, 80px);
  align-items: end;
}
.bn .ctas { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
.bn .btn {
  display: inline-flex; align-items: center; gap: 12px;
  padding: 13px 20px; border-radius: 2px;
  font-size: 13px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600;
  border: 2px solid var(--ink); background: transparent; color: var(--ink);
  cursor: pointer; transition: transform .15s ease;
}
.bn .btn:hover { transform: translateY(-1px); }
.bn .btn.primary,
.bn .btn.large {
  background: var(--ink); color: var(--paper);
  box-shadow: 6px 6px 0 0 var(--ink-mute);
}
.bn .btn.primary:hover,
.bn .btn.large:hover { box-shadow: 8px 8px 0 0 var(--ink-mute); }
.bn .btn.secondary {
  background: transparent; color: var(--ink); box-shadow: none;
}
.bn .btn.secondary.large {
  background: transparent; color: var(--ink); box-shadow: none;
  padding: 13px 20px;
}
.bn .btn.block { display: block; width: 100%; text-align: center; justify-content: center; }
.bn .btn .arrow { font-weight: 400; font-size: 16px; line-height: 1; }
.bn .btn-meta { font-size: 12px; color: var(--ink-mute); letter-spacing: 0.04em; max-width: 28ch; }

.bn .hero-side {
  display: flex; flex-direction: column; gap: 14px;
  border-left: 2px solid var(--rule);
  padding-left: clamp(20px, 2.4vw, 36px);
}
.bn .hero-side .quote-num {
  font-size: clamp(40px, 4.2vw, 56px);
  font-weight: 600; letter-spacing: -0.04em; line-height: 1;
}
.bn .hero-side .quote-num .unit { font-size: 0.4em; font-weight: 500; color: var(--ink-mute); letter-spacing: 0; margin-left: 4px; vertical-align: 12px; }
.bn .hero-side p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--ink-soft); }

/* — Secondary marketing page header (lighter than the editorial hero) — */
.bn .page-hero {
  padding: clamp(48px, 6vw, 96px) 0 clamp(36px, 4vw, 64px);
  border-bottom: 2px solid var(--rule);
}
.bn .page-hero .wrap { display: grid; gap: clamp(16px, 1.6vw, 24px); }
.bn .page-hero .eyebrow { margin: 0; }
.bn .page-hero h1 {
  margin: 0;
  font-weight: 600;
  font-size: clamp(36px, 4.6vw, 64px);
  letter-spacing: -0.035em;
  line-height: 1.0;
  max-width: 22ch;
  text-wrap: balance;
}
.bn .page-hero .lead {
  margin: 0;
  font-size: clamp(16px, 1.3vw, 19px);
  color: var(--ink-soft);
  max-width: 56ch;
  line-height: 1.5;
}
.bn .page-hero .hero-actions {
  display: flex; gap: 16px; flex-wrap: wrap; align-items: center; margin-top: clamp(12px, 1.4vw, 20px);
}

/* — Generic section primitives — */
.bn .section {
  padding: clamp(56px, 6vw, 96px) 0;
  border-bottom: 1px solid var(--hair);
}
.bn .section:last-of-type { border-bottom: 2px solid var(--rule); }
.bn .section > .wrap > .section-head + * { margin-top: clamp(28px, 3vw, 40px); }
.bn .section-head {
  display: grid; grid-template-columns: 1.2fr 2fr;
  gap: clamp(32px, 5vw, 80px);
  align-items: end;
  margin-bottom: clamp(28px, 3vw, 44px);
}
.bn .section-head > div:first-child { display: grid; gap: 10px; }
.bn .section-head h2 {
  margin: 0; font-weight: 600;
  font-size: clamp(28px, 3vw, 44px); letter-spacing: -0.025em; line-height: 1.05;
  max-width: 22ch;
}
.bn .section-head .lead { margin: 0; }
.bn .section-head .link { font-size: 12px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600; }
.bn .section h2 {
  margin: 0; font-weight: 600;
  font-size: clamp(28px, 3vw, 44px); letter-spacing: -0.025em; line-height: 1.05;
}
.bn .section h3 {
  margin: 0; font-weight: 600;
  font-size: clamp(20px, 1.8vw, 26px); letter-spacing: -0.015em; line-height: 1.15;
}

/* Prose */
.bn .prose-section { }
.bn .prose-section .wrap { max-width: 760px; }
.bn .prose-section h2 {
  font-size: clamp(28px, 3vw, 44px); letter-spacing: -0.025em; line-height: 1.05;
  margin-bottom: clamp(20px, 2vw, 32px);
  max-width: 22ch;
}
.bn .prose {
  font-size: clamp(16px, 1.2vw, 18px); line-height: 1.65; color: var(--ink-soft);
  margin: 0 0 1.2em 0; max-width: 64ch;
}
.bn .prose:last-child { margin-bottom: 0; }
.bn .prose strong { color: var(--ink); font-weight: 600; }
.bn .prose em { font-style: italic; }
.bn .prose a { border-bottom: 1px solid var(--ink); padding-bottom: 1px; }

/* Grid of cards */
.bn .grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  border-top: 2px solid var(--rule);
  border-left: 1px solid var(--hair);
}
.bn .grid .card {
  padding: 32px clamp(20px, 2.4vw, 36px) 36px;
  border-right: 1px solid var(--hair);
  border-bottom: 1px solid var(--hair);
  background: transparent;
  display: flex; flex-direction: column; gap: 14px;
}
.bn .grid .card h3 {
  margin: 0; font-size: clamp(20px, 1.8vw, 26px); font-weight: 600;
  letter-spacing: -0.02em; line-height: 1.15; max-width: 16ch;
}
.bn .grid .card p {
  margin: 0; font-size: 14px; line-height: 1.6; color: var(--ink-soft); max-width: 36ch;
}
.bn .grid .card .muted { color: var(--ink-mute); }
.bn .grid .card.contact-channel {
  gap: 12px;
}
.bn .grid .card.contact-channel .channel-email {
  margin-top: auto;
  font-family: var(--font-inter), monospace;
  font-size: 13.5px; font-weight: 600;
  border-bottom: 1px solid var(--ink); padding-bottom: 1px;
  align-self: flex-start;
}

/* Step list (publishers' "how partnership works") */
.bn .step-list {
  list-style: none; padding: 0; margin: 0;
  display: grid; gap: 0;
  border-top: 2px solid var(--rule);
}
.bn .step-item {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: clamp(20px, 2.4vw, 36px);
  padding: 28px 0;
  border-bottom: 1px solid var(--hair);
}
.bn .step-item:last-child { border-bottom: 2px solid var(--rule); }
.bn .step-item .step-num {
  font-size: clamp(28px, 3vw, 44px); font-weight: 600;
  letter-spacing: -0.04em; line-height: 1; color: var(--ink-mute);
}
.bn .step-item h3 {
  margin: 0 0 8px 0; font-size: clamp(20px, 1.8vw, 26px); font-weight: 600;
  letter-spacing: -0.02em; line-height: 1.15;
}
.bn .step-item p {
  margin: 0; font-size: 14px; line-height: 1.6; color: var(--ink-soft); max-width: 56ch;
}

/* CTA block (end-of-page) */
.bn .cta-block {
  padding: clamp(64px, 8vw, 120px) 0;
  text-align: left;
  border-bottom: 2px solid var(--rule);
}
.bn .cta-block .wrap { max-width: 920px; }
.bn .cta-block h2 {
  margin: 0 0 20px 0;
  font-weight: 600;
  font-size: clamp(36px, 4.8vw, 72px);
  letter-spacing: -0.04em; line-height: 0.98;
  max-width: 18ch;
}
.bn .cta-block p {
  margin: 0 0 28px 0; font-size: 15px; color: var(--ink-soft); max-width: 52ch;
}
.bn .cta-block .hero-actions {
  display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
}

/* Tables — generic */
.bn .table-wrap {
  width: 100%;
  overflow-x: auto;
  border-top: 2px solid var(--rule);
}
.bn .table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.bn .table thead th {
  text-align: left;
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600;
  color: var(--ink-mute);
  padding: 14px 16px 14px 0;
  border-bottom: 1px solid var(--hair);
}
.bn .table tbody td {
  padding: 14px 16px 14px 0;
  border-bottom: 1px solid var(--hair);
  font-size: 14px;
  vertical-align: top;
}
.bn .table tbody tr:last-child td { border-bottom: 2px solid var(--rule); }
.bn .table td.muted { color: var(--ink-mute); }

/* Badges */
.bn .badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 2px;
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600;
  background: transparent; color: var(--ink);
  border: 1px solid var(--ink);
}
.bn .badge-success { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.bn .badge-info { background: transparent; color: var(--ink-soft); border-color: var(--hair); }
.bn .badge-warning { background: var(--warn); color: var(--paper); border-color: var(--warn); }
.bn .badge-danger { background: var(--NO); color: var(--paper); border-color: var(--NO); }

/* — Publishers band — */
.bn .pubs {
  padding: clamp(56px, 6vw, 96px) 0;
  border-bottom: 2px solid var(--rule);
}
.bn .pubs-head {
  display: flex; justify-content: space-between; align-items: baseline; gap: 24px; flex-wrap: wrap;
  margin-bottom: clamp(28px, 3vw, 44px);
}
.bn .pubs-head .label-lg {
  font-size: clamp(13px, 1vw, 14px); text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600;
}
.bn .pubs-head .meta { font-size: 12px; color: var(--ink-mute); letter-spacing: 0.04em; text-transform: uppercase; }
.bn .pubs-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid var(--hair);
  border-left: 1px solid var(--hair);
}
.bn .pubs-grid .cell {
  padding: 24px 22px;
  border-right: 1px solid var(--hair);
  border-bottom: 1px solid var(--hair);
  display: flex; flex-direction: column; gap: 4px;
  min-height: 92px; justify-content: center;
}
.bn .pubs-grid .cell .pub-name {
  font-size: clamp(18px, 1.6vw, 22px); font-weight: 600; letter-spacing: -0.02em; line-height: 1.1;
}
.bn .pubs-grid .cell .pub-meta {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-mute); font-weight: 500;
}
.bn .flag { display: inline-block; width: 8px; height: 8px; margin-right: 6px; vertical-align: 1px; }
.bn .flag.no { background: var(--NO); }
.bn .flag.se { background: var(--SE); }
.bn .flag.dk { background: var(--DK); }
.bn .flag.fi { background: var(--FI); }
.bn .flag.de { background: var(--DE); }
.bn .flag.at { background: var(--AT); }
.bn .flag.ch { background: var(--CH); }
.bn .flag.uk { background: var(--UK); }
.bn .flag.ie { background: var(--IE); }

.bn .pubs-foot {
  margin-top: 22px;
  font-size: 13px;
  color: var(--ink-soft);
  letter-spacing: 0.02em;
}
.bn .pubs-foot .more {
  border-bottom: 1px solid var(--ink); padding-bottom: 1px;
}

/* — Catalog — */
.bn .catalog { padding: clamp(64px, 7vw, 104px) 0; border-bottom: 2px solid var(--rule); }
.bn .cat-head { display: flex; justify-content: space-between; align-items: end; gap: 24px; margin-bottom: clamp(28px, 3vw, 40px); flex-wrap: wrap; }
.bn .cat-head h2 {
  margin: 8px 0 0 0; font-weight: 600; font-size: clamp(28px, 3vw, 44px);
  letter-spacing: -0.025em; line-height: 1.05; max-width: 22ch;
}
.bn .cat-head .ask {
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600;
  border-bottom: 1px solid var(--ink); padding-bottom: 2px;
}

.bn .cat-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.bn .cat-table thead th {
  text-align: left;
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600;
  color: var(--ink-mute);
  padding: 12px 14px 12px 0;
  border-bottom: 2px solid var(--rule);
}
.bn .cat-table thead th.num { text-align: right; padding-right: 0; }
.bn .cat-table tbody td {
  padding: 14px 14px 14px 0;
  border-bottom: 1px solid var(--hair);
  font-size: 14px;
  vertical-align: middle;
}
.bn .cat-table tbody td.num { text-align: right; padding-right: 0; font-feature-settings: "tnum" 1; }
.bn .cat-table tbody tr:last-child td { border-bottom: none; }
.bn .cat-table .title-name { font-weight: 600; letter-spacing: -0.005em; }
.bn .cat-table .pub { color: var(--ink-mute); font-size: 12.5px; }
.bn .cat-table .cat-tag {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-mute); font-weight: 500;
}
.bn .cat-table tbody tr.active td {
  background: var(--ink); color: var(--paper);
  border-bottom-color: var(--ink);
}
.bn .cat-table tbody tr.active .pub,
.bn .cat-table tbody tr.active .cat-tag { color: rgba(237, 232, 219, .65); }
.bn .cat-table tbody tr.active td:first-child { padding-left: 14px; }
.bn .cat-table tbody tr.active td:last-child { padding-right: 14px; }

.bn .cat-foot {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-top: 22px; gap: 24px; flex-wrap: wrap;
  font-size: 13px; color: var(--ink-soft);
}
.bn .cat-foot .ind { font-size: 11px; color: var(--ink-mute); text-transform: uppercase; letter-spacing: 0.14em; font-weight: 500; }

/* — Stats band — */
.bn .stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-bottom: 2px solid var(--rule);
}
.bn .stats .cell {
  padding: clamp(40px, 4.4vw, 64px) clamp(20px, 2.6vw, 36px);
  border-right: 1px solid var(--hair);
  display: flex; flex-direction: column; gap: 8px;
}
.bn .stats .cell:last-child { border-right: none; }
.bn .stats .cell .v {
  font-size: clamp(48px, 5.8vw, 84px); font-weight: 600;
  letter-spacing: -0.04em; line-height: 0.95;
}
.bn .stats .cell .l {
  font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600;
  color: var(--ink);
}
.bn .stats .cell .sub {
  font-size: 13px; color: var(--ink-mute); line-height: 1.4; margin-top: 4px;
}

/* — How — */
.bn .how { padding: clamp(64px, 7vw, 104px) 0; border-bottom: 2px solid var(--rule); }
.bn .how-head { margin-bottom: clamp(36px, 4vw, 56px); max-width: 32ch; }
.bn .how-head h2 {
  margin: 8px 0 0 0; font-weight: 600; font-size: clamp(32px, 3.6vw, 56px);
  letter-spacing: -0.03em; line-height: 1.02;
}
.bn .how-cols {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}
.bn .how-cols .col {
  padding: 0 clamp(20px, 2.4vw, 36px);
  border-right: 1px solid var(--hair);
}
.bn .how-cols .col:first-child { padding-left: 0; }
.bn .how-cols .col:last-child { padding-right: 0; border-right: none; }
.bn .how-cols .step-num {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600; color: var(--ink-mute);
  margin-bottom: 16px;
}
.bn .how-cols h3 {
  margin: 0 0 12px 0; font-size: clamp(20px, 1.8vw, 26px); font-weight: 600; letter-spacing: -0.015em; line-height: 1.15;
}
.bn .how-cols p {
  margin: 0; font-size: 14px; line-height: 1.55; color: var(--ink-soft); max-width: 32ch;
}
.bn .how-cols .col-time {
  margin-top: 18px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-mute); font-weight: 500;
}

/* — Objections — */
.bn .obj { padding: clamp(64px, 7vw, 104px) 0; border-bottom: 2px solid var(--rule); }
.bn .obj-grid {
  display: grid; grid-template-columns: 1fr 2fr;
  gap: clamp(32px, 5vw, 80px);
}
.bn .obj h2 {
  margin: 0; font-weight: 600; font-size: clamp(32px, 3.6vw, 56px);
  letter-spacing: -0.03em; line-height: 1.02; max-width: 12ch;
}
.bn .obj .qas { display: grid; gap: 0; border-top: 1px solid var(--hair); }
.bn .obj .qa { padding: 22px 0; border-bottom: 1px solid var(--hair); display: grid; grid-template-columns: 1fr 1.8fr; gap: 32px; align-items: baseline; }
.bn .obj .qa .q {
  font-size: clamp(16px, 1.3vw, 18px); font-weight: 600; letter-spacing: -0.01em;
}
.bn .obj .qa .a {
  font-size: 14px; line-height: 1.55; color: var(--ink-soft);
}

/* — End CTA (homepage) — */
.bn .end-cta {
  padding: clamp(80px, 9vw, 140px) 0;
  text-align: left;
  border-bottom: 2px solid var(--rule);
}
.bn .end-cta h2 {
  margin: 0 0 28px 0;
  font-weight: 600;
  font-size: clamp(40px, 5.4vw, 80px);
  letter-spacing: -0.04em; line-height: 0.98;
  max-width: 16ch;
}
.bn .end-cta p { margin: 0 0 36px 0; font-size: 15px; color: var(--ink-soft); max-width: 52ch; }
.bn .end-cta .row { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
.bn .end-cta .qual {
  font-size: 12px; color: var(--ink-mute); letter-spacing: 0.04em; max-width: 36ch;
}

/* — Shared page footer — */
.bn .page-foot { padding: 36px 0 56px; }
.bn .page-foot .wrap { display: flex; justify-content: space-between; align-items: end; gap: 32px; flex-wrap: wrap; }
.bn .page-foot .left { display: flex; flex-direction: column; gap: 6px; }
.bn .page-foot .brand-foot { font-weight: 600; letter-spacing: -0.02em; font-size: 17px; }
.bn .page-foot .copy { font-size: 11.5px; color: var(--ink-mute); letter-spacing: 0.14em; text-transform: uppercase; }
.bn .page-foot .copy .roman { font-variant-numeric: oldstyle-nums; }
.bn .page-foot nav { display: flex; gap: 28px; flex-wrap: wrap; }
.bn .page-foot nav a { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-soft); font-weight: 500; }
.bn .page-foot nav a:hover { color: var(--ink); }
.bn .page-foot .markets { display: flex; gap: 14px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--ink-mute); font-weight: 500; }

/* — Why native works — */
.bn .why { padding: clamp(64px, 7vw, 104px) 0; border-bottom: 2px solid var(--rule); }
.bn .why-head {
  display: grid; grid-template-columns: 1.4fr 2fr;
  gap: clamp(32px, 5vw, 80px);
  align-items: end;
  margin-bottom: clamp(40px, 4.5vw, 64px);
}
.bn .why-head h2 {
  margin: 10px 0 0 0; font-weight: 600;
  font-size: clamp(32px, 3.6vw, 56px); letter-spacing: -0.03em; line-height: 1.02;
  max-width: 16ch;
}
.bn .why-head .lead {
  margin: 0; font-size: clamp(15px, 1.2vw, 17px); line-height: 1.55; color: var(--ink-soft); max-width: 50ch;
}
.bn .why-cols { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 2px solid var(--rule); }
.bn .why-cols .col {
  padding: 32px clamp(20px, 2.4vw, 36px) 36px;
  border-right: 1px solid var(--hair);
}
.bn .why-cols .col:first-child { padding-left: 0; }
.bn .why-cols .col:last-child { padding-right: 0; border-right: none; }
.bn .why-cols .ix {
  font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600;
  color: var(--ink-mute); margin-bottom: 22px;
}
.bn .why-cols h3 {
  margin: 0 0 14px 0; font-size: clamp(22px, 2vw, 28px); font-weight: 600;
  letter-spacing: -0.02em; line-height: 1.1; max-width: 16ch;
}
.bn .why-cols p {
  margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: var(--ink-soft); max-width: 36ch;
}
.bn .why-cols .pull {
  font-size: 12.5px; color: var(--ink-mute); letter-spacing: 0.01em;
  border-top: 1px solid var(--hair); padding-top: 14px; margin-top: 6px; max-width: 36ch;
  font-style: italic;
}
.bn .why-cols .pull strong { font-style: normal; color: var(--ink); font-weight: 600; }

/* — Vs display table — */
.bn .vs { padding: clamp(64px, 7vw, 104px) 0; border-bottom: 2px solid var(--rule); }
.bn .vs-head { margin-bottom: clamp(28px, 3vw, 40px); max-width: 32ch; }
.bn .vs-head h2 {
  margin: 8px 0 0 0; font-weight: 600;
  font-size: clamp(28px, 3vw, 44px); letter-spacing: -0.025em; line-height: 1.05;
}
.bn .vs-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.bn .vs-table thead th {
  text-align: left; padding: 14px 24px 14px 0;
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600;
  color: var(--ink-mute); border-bottom: 2px solid var(--rule);
}
.bn .vs-table thead th.native { color: var(--ink); }
.bn .vs-table thead th.spec { width: 22%; }
.bn .vs-table tbody td {
  padding: 22px 24px 22px 0; vertical-align: top;
  border-bottom: 1px solid var(--hair); font-size: 14.5px; line-height: 1.5;
}
.bn .vs-table tbody tr:last-child td { border-bottom: none; }
.bn .vs-table tbody td.spec {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; font-weight: 600;
  color: var(--ink-mute);
}
.bn .vs-table tbody td.native { color: var(--ink); font-weight: 500; }
.bn .vs-table tbody td.display { color: var(--ink-mute); }

/* — Golden rule — */
.bn .rule { background: var(--ink); color: var(--paper); padding: clamp(80px, 9vw, 140px) 0; border-bottom: 2px solid var(--rule); }
.bn .rule .wrap {
  display: grid; grid-template-columns: 1fr 1.7fr;
  gap: clamp(32px, 5vw, 80px);
  align-items: start;
}
.bn .rule .label-ix {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600;
  color: rgba(237,232,219,.55);
}
.bn .rule h2 {
  margin: 12px 0 0 0; font-weight: 600;
  font-size: clamp(34px, 4vw, 64px); letter-spacing: -0.035em; line-height: 1.0;
  color: var(--paper); max-width: 14ch;
}
.bn .rule .body {
  margin: 0; font-size: clamp(16px, 1.4vw, 22px); line-height: 1.45;
  color: rgba(237,232,219,.88); max-width: 44ch;
  letter-spacing: -0.005em;
}
.bn .rule .body em { font-style: italic; color: var(--paper); }
.bn .rule .sig {
  margin-top: 28px;
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; color: rgba(237,232,219,.55); font-weight: 500;
}

/* — Legal docs (privacy / terms) — */
.bn .legal-doc { padding-bottom: 0; }
.bn .legal-doc .page-hero .last-updated {
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-mute); margin: 0;
}
.bn .legal-doc .legal-body {
  max-width: 760px;
  margin: 0 auto;
  padding: clamp(48px, 5vw, 80px) var(--pad) clamp(64px, 7vw, 96px);
  border-bottom: 2px solid var(--rule);
}
.bn .legal-doc .legal-section {
  padding: 28px 0;
  border-bottom: 1px solid var(--hair);
}
.bn .legal-doc .legal-section:first-child { padding-top: 0; }
.bn .legal-doc .legal-section:last-child { border-bottom: none; padding-bottom: 0; }
.bn .legal-doc .legal-section h2 {
  margin: 0 0 12px 0; font-weight: 600;
  font-size: clamp(20px, 1.8vw, 26px); letter-spacing: -0.015em; line-height: 1.2;
}
.bn .legal-doc .legal-section .prose { max-width: none; }

/* — Auth shell (signin) — */
.bn .auth-shell {
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: calc(100vh - 200px);
  border-bottom: 2px solid var(--rule);
}
.bn .auth-shell .marketing {
  padding: clamp(48px, 6vw, 96px) var(--pad);
  border-right: 2px solid var(--rule);
  display: flex; flex-direction: column; gap: clamp(16px, 1.8vw, 28px); justify-content: center;
}
.bn .auth-shell .marketing .eyebrow { margin: 0; }
.bn .auth-shell .marketing h1 {
  margin: 0; font-weight: 600;
  font-size: clamp(32px, 4vw, 56px); letter-spacing: -0.035em; line-height: 1.0;
  max-width: 18ch;
}
.bn .auth-shell .marketing .lead {
  margin: 0; font-size: clamp(15px, 1.2vw, 17px); color: var(--ink-soft); max-width: 44ch; line-height: 1.55;
}
.bn .auth-shell .marketing .pull {
  border-left: 2px solid var(--ink); padding: 10px 0 10px 20px;
  font-size: 14px; line-height: 1.55; color: var(--ink-soft); max-width: 44ch;
}
.bn .auth-shell .marketing .pull strong {
  display: block; color: var(--ink); font-weight: 600;
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; margin-bottom: 6px;
}
.bn .auth-shell .signup-bullets {
  list-style: none; padding: 0; margin: 0; display: grid; gap: 12px;
}
.bn .auth-shell .signup-bullets li {
  font-size: 14px; color: var(--ink-soft); line-height: 1.5;
  padding-left: 20px; position: relative;
}
.bn .auth-shell .signup-bullets li::before {
  content: ""; position: absolute; left: 0; top: 9px; width: 10px; height: 1px; background: var(--ink);
}
.bn .auth-card {
  padding: clamp(48px, 6vw, 96px) var(--pad);
  display: flex; flex-direction: column; gap: 24px; justify-content: center;
  background: var(--paper-2);
}
.bn .auth-card form { display: grid; gap: 20px; }
.bn .auth-card .head h2 {
  margin: 0 0 8px 0; font-weight: 600;
  font-size: clamp(24px, 2.4vw, 32px); letter-spacing: -0.02em; line-height: 1.1;
}
.bn .auth-card .head p {
  margin: 0; font-size: 14px; color: var(--ink-soft); line-height: 1.55;
}
.bn .auth-card .field { display: grid; gap: 6px; }
.bn .auth-card .field label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600; color: var(--ink);
}
.bn .auth-card .field input,
.bn .auth-card .field select,
.bn .auth-card .field textarea {
  padding: 12px 14px; border: 2px solid var(--ink); border-radius: 2px;
  background: var(--paper); color: var(--ink);
  font-family: inherit; font-size: 14px; line-height: 1.4;
  transition: outline .15s ease;
}
.bn .auth-card .field input:focus,
.bn .auth-card .field select:focus,
.bn .auth-card .field textarea:focus {
  outline: 3px solid var(--ink); outline-offset: -2px;
}
.bn .auth-card .field textarea { resize: vertical; min-height: 96px; }
.bn .auth-card .field .hint {
  font-size: 12px; color: var(--ink-mute); margin-top: 2px;
}
.bn .auth-card .field label .optional {
  text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--ink-mute);
}
.bn .auth-card .actions { margin-top: 4px; }
.bn .auth-card .alt {
  font-size: 13px; color: var(--ink-soft); text-align: center;
}
.bn .auth-card .alt a { border-bottom: 1px solid var(--ink); padding-bottom: 1px; font-weight: 600; }
.bn .banner-error {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: var(--NO); color: var(--paper);
  font-size: 13px; font-weight: 500;
  border-radius: 2px;
}
.bn .demo-block {
  display: flex; flex-direction: column; gap: 10px; padding-top: 16px;
  border-top: 1px solid var(--hair);
}
.bn .demo-block > .label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-mute); font-weight: 600;
}
.bn .demo-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.bn .demo-chip {
  padding: 6px 12px; border: 1px solid var(--ink); background: transparent; color: var(--ink);
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 600;
  cursor: pointer; border-radius: 2px;
}
.bn .demo-chip:hover,
.bn .demo-chip[data-active="true"] { background: var(--ink); color: var(--paper); }

/* Contact shell uses auth-shell layout */
.bn .contact-shell { min-height: 0; }

/* — Skeleton lines (marketing loading) — */
.bn .skel {
  display: block;
  background: linear-gradient(90deg, rgba(20,17,12,.08) 0%, rgba(20,17,12,.16) 50%, rgba(20,17,12,.08) 100%);
  background-size: 200% 100%;
  border-radius: 2px;
  animation: bn-skel-shimmer 1.4s ease-in-out infinite;
}
.bn .skel-eyebrow { width: 120px; height: 12px; margin-bottom: 18px; }
.bn .skel-h1 { width: 60%; max-width: 520px; height: clamp(36px, 4vw, 56px); margin-bottom: 18px; }
.bn .skel-lead { width: 80%; max-width: 640px; height: 18px; }
.bn .skel-line { height: 14px; margin-bottom: 10px; width: 100%; }
.bn .skel-line.short { width: 60%; }
@keyframes bn-skel-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* — Utility page (404) — */
.bn .utility-page {
  min-height: calc(100vh - 200px);
  padding: clamp(64px, 8vw, 120px) var(--pad);
  display: flex; flex-direction: column; gap: 20px; justify-content: center;
  max-width: 760px; margin: 0 auto;
  border-bottom: 2px solid var(--rule);
}
.bn .utility-code {
  font-size: clamp(80px, 10vw, 160px); font-weight: 600; letter-spacing: -0.05em; line-height: 0.9;
  color: var(--ink); margin: 0;
}
.bn .utility-page h1 {
  margin: 0; font-weight: 600;
  font-size: clamp(28px, 3vw, 44px); letter-spacing: -0.025em; line-height: 1.05;
}
.bn .utility-page .lead {
  margin: 0; font-size: clamp(15px, 1.2vw, 17px); color: var(--ink-soft); max-width: 56ch;
}
.bn .utility-page .cluster {
  display: flex; gap: 16px; flex-wrap: wrap; margin-top: 16px;
}

/* — Pricing plan cards — */
.bn .grid .card.plan-card {
  position: relative;
  gap: 16px;
}
.bn .grid .card.plan-card.is-featured {
  background: var(--ink);
  color: var(--paper);
  border-right-color: var(--ink);
  border-bottom-color: var(--ink);
}
.bn .grid .card.plan-card.is-featured h3,
.bn .grid .card.plan-card.is-featured .price,
.bn .grid .card.plan-card.is-featured p,
.bn .grid .card.plan-card.is-featured li { color: var(--paper); }
.bn .grid .card.plan-card.is-featured .muted { color: rgba(237,232,219,.7); }
.bn .grid .card.plan-card.is-featured .plan-badge {
  background: var(--paper); color: var(--ink); border-color: var(--paper);
}
.bn .grid .card.plan-card .plan-badge {
  align-self: flex-start;
}
.bn .grid .card.plan-card .price {
  font-size: clamp(36px, 4vw, 56px); font-weight: 600; letter-spacing: -0.04em; line-height: 1;
  margin-top: 4px;
}
.bn .grid .card.plan-card .plan-features {
  list-style: none; padding: 0; margin: 8px 0 0 0; display: grid; gap: 10px;
}
.bn .grid .card.plan-card .plan-features li {
  font-size: 13.5px; line-height: 1.5; color: var(--ink-soft); padding-left: 20px; position: relative;
}
.bn .grid .card.plan-card.is-featured .plan-features li { color: rgba(237,232,219,.85); }
.bn .grid .card.plan-card .plan-features li::before {
  content: ""; position: absolute; left: 0; top: 9px; width: 10px; height: 1px; background: var(--ink);
}
.bn .grid .card.plan-card.is-featured .plan-features li::before { background: var(--paper); }
.bn .grid .card.plan-card .plan-cta { margin-top: auto; padding-top: 8px; }
.bn .grid .card.plan-card.is-featured .plan-cta .btn {
  background: var(--paper); color: var(--ink); border-color: var(--paper); box-shadow: 6px 6px 0 0 rgba(237,232,219,.35);
}

/* — Filters bar (recommend page) — */
.bn .filters {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)) auto;
  gap: 16px; align-items: end;
  padding: 24px;
  background: var(--paper-2);
  border: 2px solid var(--ink); border-radius: 2px;
  margin-bottom: clamp(32px, 4vw, 48px);
}
.bn .filters > div { display: grid; gap: 6px; }
.bn .filters label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600; color: var(--ink);
}
.bn .filters input,
.bn .filters select {
  padding: 11px 14px; border: 2px solid var(--ink); border-radius: 2px;
  background: var(--paper); color: var(--ink);
  font-family: inherit; font-size: 14px;
}
.bn .filters input:focus,
.bn .filters select:focus { outline: 3px solid var(--ink); outline-offset: -2px; }
.bn .filters button[type="submit"] {
  padding: 13px 20px; border: 2px solid var(--ink); background: var(--ink); color: var(--paper);
  font-size: 13px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600;
  cursor: pointer; border-radius: 2px;
  box-shadow: 6px 6px 0 0 var(--ink-mute);
  transition: transform .15s ease;
}
.bn .filters button[type="submit"]:hover { transform: translateY(-1px); box-shadow: 8px 8px 0 0 var(--ink-mute); }

/* — KPI band (recommend results) — */
.bn .kpi-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  border-top: 2px solid var(--rule); border-left: 1px solid var(--hair);
  margin-bottom: clamp(32px, 4vw, 48px);
}
.bn .kpi-grid .kpi {
  padding: 28px clamp(20px, 2.2vw, 32px);
  border-right: 1px solid var(--hair); border-bottom: 1px solid var(--hair);
  display: flex; flex-direction: column; gap: 6px;
}
.bn .kpi-grid .kpi .label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600; color: var(--ink-mute);
}
.bn .kpi-grid .kpi .value {
  font-size: clamp(28px, 3vw, 40px); font-weight: 600; letter-spacing: -0.03em; line-height: 1;
}
.bn .kpi-grid .kpi .delta {
  font-size: 12px; color: var(--ink-soft); line-height: 1.4;
}

/* Recommend result cards inherit .grid .card */
.bn .grid .card .tag {
  display: inline-flex; align-self: flex-start;
  padding: 4px 8px; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600;
  border: 1px solid var(--ink); border-radius: 2px;
}
.bn .grid .card .price {
  font-size: clamp(22px, 2vw, 28px); font-weight: 600; letter-spacing: -0.02em; margin-top: 6px;
}

/* Empty state */
.bn .empty {
  padding: clamp(48px, 6vw, 96px) var(--pad);
  text-align: center;
  border-top: 2px solid var(--rule); border-bottom: 2px solid var(--rule);
}
.bn .empty .empty-icon {
  font-size: 36px; color: var(--ink-mute); margin-bottom: 14px;
}
.bn .empty .empty-title {
  margin: 0 0 8px 0; font-weight: 600; font-size: clamp(20px, 2vw, 28px); letter-spacing: -0.015em;
}
.bn .empty p { margin: 0; font-size: 14px; color: var(--ink-soft); }

/* — Formats page — */
.bn .format-list {
  display: grid; gap: 0;
  border-top: 2px solid var(--rule);
}
.bn .format-card {
  padding: clamp(36px, 4vw, 56px) 0;
  border-bottom: 1px solid var(--hair);
  scroll-margin-top: 80px;
}
.bn .format-card:last-child { border-bottom: 2px solid var(--rule); }
.bn .format-card-head { display: grid; gap: 14px; margin-bottom: clamp(20px, 2.4vw, 32px); }
.bn .format-card-head .eyebrow { margin: 0; }
.bn .format-card-head h2 {
  margin: 0; font-weight: 600;
  font-size: clamp(28px, 3vw, 44px); letter-spacing: -0.025em; line-height: 1.05;
  max-width: 22ch;
}
.bn .format-card-head .lead { margin: 0; }
.bn .format-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  border-top: 1px solid var(--hair);
  border-left: 1px solid var(--hair);
  margin: 0;
}
.bn .format-grid > div {
  padding: 20px clamp(16px, 1.8vw, 24px);
  border-right: 1px solid var(--hair);
  border-bottom: 1px solid var(--hair);
  display: flex; flex-direction: column; gap: 6px;
}
.bn .format-grid dt {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; font-weight: 600; color: var(--ink-mute);
  margin: 0;
}
.bn .format-grid dd {
  margin: 0; font-size: 14px; color: var(--ink); line-height: 1.5;
}
.bn .format-rule {
  margin: clamp(20px, 2vw, 28px) 0 0 0;
  padding: 16px 20px;
  border-left: 2px solid var(--ink); background: rgba(20,17,12,.04);
  font-size: 14px; line-height: 1.55; color: var(--ink-soft); max-width: 64ch;
  font-style: italic;
}
.bn .format-rule strong { color: var(--ink); font-weight: 600; font-style: normal; }
.bn .compare-formats-table th,
.bn .compare-formats-table td {
  padding: 14px 16px 14px 0;
  border-bottom: 1px solid var(--hair);
  font-size: 13.5px;
  vertical-align: top;
}
.bn .compare-formats-table thead th {
  text-align: left;
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.16em; font-weight: 600;
  color: var(--ink-mute);
  border-bottom: 2px solid var(--rule);
}

/* Responsive */
@media (max-width: 960px) {
  .bn .hero-cluster { grid-template-columns: 1fr; }
  .bn .hero-side { border-left: none; border-top: 2px solid var(--rule); padding-left: 0; padding-top: 24px; }
  .bn .pubs-grid { grid-template-columns: repeat(2, 1fr); }
  .bn .stats { grid-template-columns: repeat(2, 1fr); }
  .bn .stats .cell:nth-child(2) { border-right: none; }
  .bn .stats .cell:nth-child(-n+2) { border-bottom: 1px solid var(--hair); }
  .bn .how-cols { grid-template-columns: 1fr; }
  .bn .how-cols .col { border-right: none; border-bottom: 1px solid var(--hair); padding: 24px 0; }
  .bn .how-cols .col:last-child { border-bottom: none; }
  .bn .obj-grid { grid-template-columns: 1fr; }
  .bn .obj .qa { grid-template-columns: 1fr; gap: 8px; }
  .bn .cat-table .hide-md { display: none; }
  .bn .cat-table thead th.hide-md { display: none; }
  .bn .why-head { grid-template-columns: 1fr; }
  .bn .rule .wrap { grid-template-columns: 1fr; }
  .bn .why-cols { grid-template-columns: 1fr; }
  .bn .why-cols .col { border-right: none; border-bottom: 1px solid var(--hair); padding: 28px 0 32px; }
  .bn .why-cols .col:last-child { border-bottom: none; }
  .bn .vs-table { table-layout: auto; }
  .bn .vs-table tbody td.spec { width: auto; }
  .bn .section-head { grid-template-columns: 1fr; gap: 16px; }
  .bn .auth-shell { grid-template-columns: 1fr; }
  .bn .auth-shell .marketing { border-right: none; border-bottom: 2px solid var(--rule); }
  .bn .step-item { grid-template-columns: 56px 1fr; gap: 16px; padding: 24px 0; }
  .bn .page-foot .wrap { flex-direction: column; align-items: flex-start; gap: 20px; }
  .bn .page-foot nav { gap: 16px 22px; }
  .bn .page-foot .markets { gap: 10px; flex-wrap: wrap; }
}
`;
