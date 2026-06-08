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
   The header (PublicHeader for anon, NavShell for signed-in users) renders
   outside the .bn wrapper, so the .bn token overrides don't reach it. The
   header is ALWAYS cream here, so restate the ink palette tokens on it —
   this fixes every token consumer at once: the SVG .brand-wordmark (reads
   --heading) and the signed-in .nav-primary links (read --muted), which
   otherwise inherit the global dark-mode tokens and render near-white on
   the cream bar for visitors whose OS is in dark mode. */
body:has(.bn) header.site-header {
  background: rgba(237, 232, 219, 0.92) !important;
  border-bottom: 2px solid #14110C !important;
  color-scheme: light;
  --heading: #14110C;
  --text: #14110C;
  --muted: #3A3528;
  --muted-strong: #3A3528;
  --ink: #14110C;
}
body:has(.bn) header.site-header .brand,
body:has(.bn) header.site-header .brand:hover { color: #14110C !important; }
/* Belt-and-suspenders for the SVG wordmark (its own color rule reads
   --heading, now restated above) and both header link flavours. */
body:has(.bn) header.site-header .brand-wordmark { color: #14110C !important; }
body:has(.bn) header.site-header .nav-mega-link,
body:has(.bn) header.site-header .nav-mega-trigger,
body:has(.bn) header.site-header .nav-primary a {
  color: #3A3528 !important;
  background: transparent !important;
}
body:has(.bn) header.site-header .nav-mega-link:hover,
body:has(.bn) header.site-header .nav-mega-trigger:hover,
body:has(.bn) header.site-header .nav-mega-trigger[aria-expanded="true"],
body:has(.bn) header.site-header .nav-mega-link[aria-current="page"],
body:has(.bn) header.site-header .nav-primary a:hover,
body:has(.bn) header.site-header .nav-primary a[aria-current="page"] {
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
  overflow-wrap: anywhere;
}
.bn .grid .card p {
  margin: 0; font-size: 14px; line-height: 1.6; color: var(--ink-soft); max-width: 36ch;
  overflow-wrap: anywhere;
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
.bn .page-foot { padding: 56px 0; }
.bn .page-foot .wrap { display: flex; flex-direction: column; gap: clamp(40px, 5vw, 64px); }
.bn .page-foot .foot-top { display: flex; justify-content: space-between; align-items: flex-start; gap: clamp(40px, 6vw, 96px); flex-wrap: wrap; }
.bn .page-foot .foot-newsletter { display: flex; flex-direction: column; gap: 14px; flex: 1 1 320px; max-width: 30rem; }
.bn .page-foot .copy { font-size: 11.5px; color: var(--ink-mute); letter-spacing: 0.14em; text-transform: uppercase; }
.bn .page-foot .copy .roman { font-variant-numeric: oldstyle-nums; }
.bn .page-foot nav { display: flex; gap: clamp(40px, 5vw, 72px); flex-wrap: wrap; }
.bn .page-foot .foot-nav-col { display: flex; flex-direction: column; gap: 14px; }
.bn .page-foot nav a { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-soft); font-weight: 500; }
.bn .page-foot nav a:hover { color: var(--ink); }
.bn .page-foot .brand-foot-block { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.bn .page-foot .brand-foot-mark { height: 22px; width: auto; display: block; color: var(--ink); }
.bn .page-foot .foot-legal { display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap; border-top: 1px solid var(--hair); padding-top: 24px; }
.bn .page-foot .markets { font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--ink-mute); font-weight: 500; }

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
.bn .rule { background: var(--ink); color: var(--paper); padding: clamp(80px, 9vw, 140px) 0; border-bottom: 2px solid var(--rule); position: relative; overflow: hidden; }
.bn .rule::before { content: ""; position: absolute; inset: 0; background-image: var(--bn-grain); opacity: .06; pointer-events: none; }
.bn .rule .wrap {
  display: grid; grid-template-columns: 1fr 1.7fr;
  gap: clamp(32px, 5vw, 80px);
  align-items: start;
  position: relative; z-index: 1;
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
/* globals.css has an unscoped .legal-doc { max-width: 760px } that was
   originally meant for inline article content; here it's the .bn root
   class, so we restore full-width and let .legal-body handle the column
   constraint instead. */
.bn.legal-doc { max-width: none; padding-bottom: 0; }
.bn.legal-doc { padding-bottom: 0; }
.bn.legal-doc .page-hero .last-updated {
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-mute); margin: 0;
}
.bn.legal-doc .legal-body {
  max-width: 760px;
  margin: 0 auto;
  padding: clamp(48px, 5vw, 80px) var(--pad) clamp(64px, 7vw, 96px);
  border-bottom: 2px solid var(--rule);
}
.bn.legal-doc .legal-section {
  padding: 28px 0;
  border-bottom: 1px solid var(--hair);
}
.bn.legal-doc .legal-section:first-child { padding-top: 0; }
.bn.legal-doc .legal-section:last-child { border-bottom: none; padding-bottom: 0; }
.bn.legal-doc .legal-section h2 {
  margin: 0 0 12px 0; font-weight: 600;
  font-size: clamp(20px, 1.8vw, 26px); letter-spacing: -0.015em; line-height: 1.2;
}
.bn.legal-doc .legal-section .prose { max-width: none; }

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
  font-family: inherit; font-size: 16px; line-height: 1.4;
  min-height: 44px;
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
.bn .auth-card .signup-password-disclosure summary {
  list-style: none;
  cursor: pointer;
  padding: 12px 0;
  min-height: 44px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-soft);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.bn .auth-card .signup-password-disclosure summary::-webkit-details-marker { display: none; }
.bn .auth-card .signup-password-disclosure summary::before {
  content: "+"; font-size: 16px; line-height: 1; color: var(--ink-mute);
}
.bn .auth-card .signup-password-disclosure[open] summary::before { content: "−"; }
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
  font-family: inherit; font-size: 16px;
  min-height: 44px;
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
  .bn .vs-table thead th, .bn .vs-table tbody td { padding-right: 12px; overflow-wrap: anywhere; }
  .bn .vs-table thead th.spec { width: 26%; }
  .bn .vs-table tbody td.spec { font-size: 10px; letter-spacing: 0.04em; }
  .bn .section-head { grid-template-columns: 1fr; gap: 16px; }
  .bn .auth-shell { grid-template-columns: 1fr; }
  .bn .auth-shell .marketing { border-right: none; border-bottom: 2px solid var(--rule); }
  .bn .step-item { grid-template-columns: 56px 1fr; gap: 16px; padding: 24px 0; }
  .bn .page-foot .wrap { flex-direction: column; align-items: flex-start; gap: 20px; }
  .bn .page-foot nav { gap: 16px 22px; }
  .bn .page-foot .markets { gap: 10px; flex-wrap: wrap; }
}
.newsletter-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.newsletter-form.compact{max-width:420px}
.newsletter-form input[type=email]{flex:1;min-width:200px;padding:10px 12px;border:1px solid var(--ink-soft);border-radius:8px;font:inherit}
.newsletter-hp{position:absolute!important;left:-9999px;width:1px;height:1px;overflow:hidden}
.newsletter-ok{color:var(--accent);font-weight:500}
.newsletter-err{color:#c0392b;flex-basis:100%;font-size:13px;margin:4px 0 0}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}
.foot-newsletter{flex-basis:100%;padding-bottom:24px;margin-bottom:8px;border-bottom:1px solid var(--line)}
.foot-newsletter .copy{margin-bottom:10px}
.newsletter-block{text-align:center}
.newsletter-block .lead{margin-left:auto;margin-right:auto;max-width:560px}
.newsletter-block .newsletter-form{justify-content:center}
.pub-strip{padding:28px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.pub-strip-label{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:14px}
.pub-strip-row{display:flex;flex-wrap:wrap;gap:14px 22px;list-style:none;margin:0;padding:0;align-items:center}
.pub-strip-logo{height:26px;width:auto;opacity:.7;filter:grayscale(1) contrast(1.05)}
.pub-strip-chip{font-weight:600;color:var(--ink-mute);font-size:15px}
.team-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px}
.team-photo,.team-avatar{width:72px;height:72px;border-radius:50%;object-fit:cover}
.team-avatar{display:flex;align-items:center;justify-content:center;background:var(--line);font-weight:600;font-size:22px;color:var(--ink-mute)}
.team-links{display:flex;gap:14px;margin-top:8px}

/* ── Preview visuals (landing showcase mocks) — namespaced .bn ── */
.bn { --bn-grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E"); }

.bn .hero-showcase { margin-top: clamp(28px, 3.4vw, 48px); }

/* generic native-article frame */
.bn .na-frame { background:#fff; border:1.5px solid var(--ink); border-radius:7px; overflow:hidden; box-shadow:0 18px 44px -26px rgba(20,17,12,.55); max-width:680px; }
.bn .na-bar { display:flex; align-items:center; gap:7px; padding:9px 12px; background:var(--paper-2); border-bottom:1px solid var(--hair); }
.bn .na-bar .dot { width:9px; height:9px; border-radius:50%; background:var(--ink-mute); opacity:.45; }
.bn .na-bar .url { margin-left:8px; font-size:10.5px; color:var(--ink-mute); background:#fff; border:1px solid var(--hair); border-radius:20px; padding:3px 12px; }
.bn .na-masthead { display:flex; justify-content:space-between; align-items:center; padding:13px 20px; border-bottom:2px solid #14110C; }
.bn .na-masthead .na-name { font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:700; color:#14110C; letter-spacing:.01em; }
.bn .na-masthead .na-nav { display:flex; gap:12px; font-size:9px; text-transform:uppercase; letter-spacing:.14em; color:var(--ink-mute); font-weight:600; }
.bn .na-art { padding:20px 26px 28px; color:#14110C; }
.bn .na-tag { display:inline-flex; align-items:center; gap:7px; font-size:9px; text-transform:uppercase; letter-spacing:.16em; font-weight:700; color:var(--ink-mute); border:1px solid var(--hair); padding:4px 9px; border-radius:2px; background:#f4f0e6; }
.bn .na-art h3 { font-family:Georgia,serif; font-size:clamp(20px,2.4vw,28px); line-height:1.08; letter-spacing:-.01em; margin:13px 0 11px; font-weight:700; max-width:22ch; }
.bn .na-art .na-standfirst { font-family:Georgia,serif; font-style:italic; font-size:15px; color:var(--ink-soft); line-height:1.5; margin:0 0 14px; max-width:46ch; }
.bn .na-art .na-byline { font-size:10px; text-transform:uppercase; letter-spacing:.12em; color:var(--ink-mute); margin-bottom:16px; }
.bn .na-photo { height:190px; border-radius:3px; position:relative; overflow:hidden; background:radial-gradient(120% 120% at 20% 10%,#c9b89a,#a8906b 40%,#6d5a40); }
.bn .na-photo::after { content:""; position:absolute; inset:0; background-image:var(--bn-grain); mix-blend-mode:overlay; opacity:.45; }
.bn .na-cols { column-count:2; column-gap:24px; margin-top:18px; }
.bn .na-cols i { display:block; height:7px; border-radius:3px; background:rgba(20,17,12,.12); margin-bottom:9px; }
.bn .na-cols i.s { width:60%; }
.bn .na-cols i.f { width:42%; background:rgba(20,17,12,.2); }

/* native vs display */
.bn .vsd { display:grid; grid-template-columns:1fr 1fr; gap:22px; align-items:start; margin-bottom:clamp(20px,2.4vw,32px); }
.bn .vsd .vsd-label { font-size:11px; text-transform:uppercase; letter-spacing:.14em; font-weight:700; margin-bottom:11px; display:flex; align-items:center; gap:8px; }
.bn .vsd .vsd-tick { width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; color:#fff; font-size:11px; line-height:1; }
.bn .vsd .good .vsd-tick { background:var(--ok); }
.bn .vsd .bad .vsd-tick { background:var(--NO); }
.bn .vsd .mini { background:#fff; border:1.5px solid var(--ink); border-radius:5px; overflow:hidden; }
.bn .vsd .mini .mini-head { padding:9px 14px; border-bottom:2px solid #14110C; font-family:Georgia,serif; font-weight:700; font-size:14px; color:#14110C; }
.bn .vsd .mini .mini-body { padding:12px 14px; position:relative; color:#14110C; }
.bn .vsd .mini .mini-tag { font-size:8px; text-transform:uppercase; letter-spacing:.16em; font-weight:700; color:var(--ink-mute); border:1px solid var(--hair); padding:3px 7px; border-radius:2px; background:#f4f0e6; display:inline-block; }
.bn .vsd .mini .mini-photo { height:90px; border-radius:2px; margin:10px 0; background:radial-gradient(120% 120% at 80% 0%,#9fb0bd,#6c8090 45%,#38454f); }
.bn .vsd .mini h4 { margin:0 0 8px; font-family:Georgia,serif; font-size:15px; line-height:1.12; font-weight:700; }
.bn .vsd .mini i { display:block; height:6px; border-radius:3px; background:rgba(20,17,12,.12); margin-bottom:7px; }
.bn .vsd .mini i.s { width:55%; }
.bn .vsd .ad { background:repeating-linear-gradient(45deg,#d8d2c2,#d8d2c2 10px,#cfc8b5 10px,#cfc8b5 20px); border:1px dashed #9a917a; display:flex; align-items:center; justify-content:center; font-size:8px; text-transform:uppercase; letter-spacing:.14em; color:var(--ink-mute); font-weight:700; position:relative; }
.bn .vsd .ad .adlbl { position:absolute; top:4px; right:5px; font-size:7px; background:rgba(20,17,12,.6); color:#fff; padding:1px 5px; border-radius:2px; }
.bn .vsd .popup { position:absolute; inset:auto 16px 14px 16px; background:#fff; border:1.5px solid var(--ink); border-radius:4px; padding:12px; box-shadow:0 12px 28px -10px rgba(20,17,12,.5); text-align:center; }
.bn .vsd .popup .x { position:absolute; top:4px; right:7px; font-size:11px; color:var(--ink-mute); }
.bn .vsd .popup strong { display:block; font-size:12px; margin-bottom:7px; }
.bn .vsd .popup .pbtn { display:inline-block; font-size:9px; text-transform:uppercase; letter-spacing:.1em; font-weight:700; background:var(--NO); color:#fff; padding:6px 13px; border-radius:3px; }
.bn .vsd-caption { font-size:11px; text-transform:uppercase; letter-spacing:.14em; color:var(--ink-mute); font-weight:600; margin:0 0 clamp(28px,3vw,40px); }

/* golden rule excerpt (grain + .wrap layering folded into the base .bn .rule rules above) */
.bn .rule-excerpt { background:rgba(237,232,219,.06); border-left:2px solid var(--paper); padding:18px 22px; border-radius:0 3px 3px 0; margin-top:24px; }
.bn .rule-excerpt .re-tag { font-size:8.5px; text-transform:uppercase; letter-spacing:.16em; color:rgba(237,232,219,.55); font-weight:700; margin-bottom:10px; }
.bn .rule-excerpt p { margin:0; font-family:Georgia,serif; font-size:15px; line-height:1.6; color:rgba(237,232,219,.92); }
.bn .rule-excerpt p .re-cap { font-size:34px; float:left; line-height:.8; margin:4px 9px 0 0; font-weight:700; color:var(--paper); }

/* brief -> quote */
.bn .bq-flow { display:grid; grid-template-columns:1fr auto 1fr; gap:20px; align-items:center; margin-top:clamp(36px,4vw,56px); }
.bn .bq-flow .bq-arrow { font-size:24px; color:var(--ink-mute); }
.bn .bq-panel { background:#fff; border:1.5px solid var(--ink); border-radius:6px; padding:18px; box-shadow:0 14px 32px -22px rgba(20,17,12,.5); }
.bn .bq-panel .bq-title { font-size:10px; text-transform:uppercase; letter-spacing:.14em; font-weight:700; color:var(--ink-mute); margin-bottom:14px; }
.bn .bq-field { margin-bottom:11px; }
.bn .bq-field .l { display:block; font-size:8.5px; text-transform:uppercase; letter-spacing:.12em; color:var(--ink-mute); font-weight:700; margin-bottom:4px; }
.bn .bq-field .v { min-height:26px; border:1.5px solid var(--hair); border-radius:3px; background:#faf8f1; display:flex; align-items:center; padding:6px 9px; font-size:11px; color:var(--ink-soft); }
.bn .bq-row2 { display:grid; grid-template-columns:1fr 1fr; gap:9px; }
.bn .bq-badge { display:inline-block; font-size:8px; text-transform:uppercase; letter-spacing:.14em; font-weight:700; background:var(--ok); color:#fff; padding:3px 8px; border-radius:2px; margin-bottom:12px; }
.bn .bq-qrow { display:flex; justify-content:space-between; align-items:center; padding:9px 0; border-bottom:1px solid var(--hair); font-size:12px; }
.bn .bq-qrow .qt { font-weight:600; color:var(--ink); }
.bn .bq-qrow .qm { font-size:9px; text-transform:uppercase; letter-spacing:.1em; color:var(--ink-mute); }
.bn .bq-qrow .qp { font-weight:700; font-variant-numeric:tabular-nums; color:var(--ink); }
.bn .bq-total { display:flex; justify-content:space-between; margin-top:12px; padding-top:12px; border-top:2px solid var(--ink); font-weight:700; font-size:14px; }

@media (max-width: 860px) {
  .bn .vsd { grid-template-columns:1fr; }
  .bn .bq-flow { grid-template-columns:1fr; }
  .bn .bq-flow .bq-arrow { transform:rotate(90deg); justify-self:center; }
}

/* ── Preview studio (interactive tool) ── */
.bn .preview-studio { display:grid; grid-template-columns:360px 1fr; gap:clamp(20px,3vw,40px); align-items:start; }
.bn .pv-controls { display:flex; flex-direction:column; gap:16px; }
.bn .pv-field { display:flex; flex-direction:column; gap:6px; }
.bn .pv-field label { font-size:10.5px; text-transform:uppercase; letter-spacing:.13em; font-weight:700; color:var(--ink); }
.bn .pv-field input, .bn .pv-field textarea, .bn .pv-field select { font:inherit; font-size:14px; padding:10px 12px; border:1.5px solid var(--ink); border-radius:3px; background:#faf8f1; color:var(--ink); width:100%; }
.bn .pv-field textarea { resize:vertical; min-height:72px; }
.bn .pv-row2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.bn .pv-gen { font:inherit; font-size:13px; text-transform:uppercase; letter-spacing:.12em; font-weight:700; background:var(--ink); color:var(--paper); border:2px solid var(--ink); border-radius:3px; padding:14px; cursor:pointer; box-shadow:5px 5px 0 0 var(--ink-mute); transition:transform .12s; }
.bn .pv-gen:hover { transform:translateY(-1px); box-shadow:7px 7px 0 0 var(--ink-mute); }
.bn .pv-gen:disabled { opacity:.5; cursor:wait; transform:none; box-shadow:none; }
.bn .pv-presets { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; }
.bn .pv-preset { aspect-ratio:1.4; border-radius:3px; cursor:pointer; border:2px solid transparent; }
.bn .pv-preset[aria-pressed="true"] { border-color:var(--ink); box-shadow:0 0 0 2px var(--paper),0 0 0 4px var(--ink); }
.bn .pv-pa { background:radial-gradient(120% 120% at 20% 10%,#c9b89a,#a8906b 40%,#6d5a40); }
.bn .pv-pb { background:radial-gradient(120% 120% at 80% 0%,#9fb0bd,#6c8090 45%,#38454f); }
.bn .pv-pc { background:linear-gradient(160deg,#3f5a3a,#1c2c1a); }
.bn .pv-pd { background:linear-gradient(160deg,#4a2f52,#22132c); }
.bn .pv-pe { background:linear-gradient(160deg,#7a2230,#3a0f17); }
.bn .pv-upload { font-size:11px; text-transform:uppercase; letter-spacing:.1em; font-weight:700; border:1.5px dashed var(--ink); border-radius:3px; padding:10px; text-align:center; cursor:pointer; }
.bn .pv-upload input { display:none; }
.bn .pv-badge { display:inline-block; font-size:9px; text-transform:uppercase; letter-spacing:.14em; font-weight:700; padding:3px 9px; border-radius:2px; margin-bottom:10px; }
.bn .pv-badge.ai { background:var(--ok); color:#fff; }
.bn .pv-badge.tpl { background:transparent; color:var(--ink-mute); border:1px solid var(--hair); }
.bn .pv-edithint { font-size:11px; color:var(--ink-mute); margin-top:10px; }
.bn .pv-error { font-size:13px; color:var(--NO); margin-top:8px; }
.bn .na-body { }
.bn .na-art .na-body p { font-family:Georgia,serif; font-size:15px; line-height:1.62; color:#1d1a13; margin:0 0 12px; }
.bn .na-art .na-body p:first-child::first-letter { font-size:42px; float:left; line-height:.8; margin:3px 8px 0 0; font-weight:700; }
.bn [contenteditable]:focus { outline:2px dashed rgba(20,17,12,.4); outline-offset:3px; border-radius:2px; }
@media (max-width: 860px) { .bn .preview-studio { grid-template-columns:1fr; } .bn .pv-presets { grid-template-columns:repeat(5,1fr); } }
`;
