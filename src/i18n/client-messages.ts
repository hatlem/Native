// Which messages reach the browser.
//
// The root layout used to hand the whole catalogue (~95 namespaces, ~200 KB of
// JSON) to NextIntlClientProvider, so every HTML response carried it inline —
// the single largest part of each page. Server components translate on the
// server and need none of it; only components that call the `useTranslations`
// hook do. This file lists what those components read.
//
// Each namespace is sent either whole (`true`) or as a list of its top-level
// entries — single keys or whole sub-objects. List entries only where the hook
// callers use string-literal keys; a component that computes keys or passes
// its `t` around needs the namespace whole.
//
// Adding a hook call, or a key in a partly-sent namespace? Update the list —
// client-messages.test.ts scans the source and names what is missing.
export const CLIENT_MESSAGES: Record<string, true | readonly string[]> = {
  account: true,
  apiKeys: [
    "bindingLabel",
    "bindingMore",
    "bindingNoMatch",
    "bindingOrgs",
    "bindingPlatformGroup",
    "bindingSearchPlaceholder",
  ],
  auth: true,
  campaignReport: [
    "avgTimeSec",
    "clicks",
    "impressions",
    "pageViews",
    "publisherTrackingUrl",
    "scrollDepthPct",
    "submit",
  ],
  catalog: [
    // sub-objects
    "compareBar",
    "filters",
    "rail",
    "shortlist",
    // keys
    "bookCallBody",
    "bookCallCta",
    "bookCallDismiss",
    "bookCallTitle",
    "savePublication",
  ],
  common: true,
  contact: true,
  deskWriters: [
    "inviteLanguage",
    "emailLabel",
    "emailPlaceholder",
    "errorExistingAccount",
    "inviteLanguageHint",
    "inviteLanguageLabel",
    "inviteNotSent",
    "inviteSent",
    "inviting",
  ],
  errors: true,
  favorites: true,
  // Assembled from per-section files (i18n/request.ts); only these sections
  // are read through the hook, the rest renders on the server.
  landing: ["newsletter", "studio"],
  nav: true,
  onboarding: true,
  plan: [
    // sub-objects
    "programme",
    "timing",
    // keys
    "activeList",
    "briefAdvancedToggle",
    "briefAutosaveHint",
    "briefQ1",
    "briefQ1Placeholder",
    "briefQ2",
    "briefSaveFailed",
    "briefSaved",
    "briefSaving",
    "cancel",
    "mobileBackToTitles",
    "mobileEdit",
    "newList",
    "newListPlaceholder",
    "rename",
    "subline",
    "sublineNoOrg",
    "switchList",
    "switchPlan",
    "totalForItems",
  ],
  publicNav: true,
  rateCard: true,
  rfq: true,
  status: true,
  targetSegment: true,
  viewOnly: true,
  writer: ["profile"],
  writerEnums: true,
};

// The namespaces a visitor WITHOUT a session can need: the client components
// on the pages the middleware lets them open (lib/auth-gate) — the public
// header, the marketing pages and forms, sign-in/up, the catalog gate, and the
// token pages publishers open from an email (rate card, campaign report).
// Everything else in CLIENT_MESSAGES is read only on signed-in pages, so the
// public pages (and the prerendered copies in app/static) skip it.
// client-messages.test.ts checks every hook outside a signed-in-only route.
export const PUBLIC_CLIENT_NAMESPACES: ReadonlySet<string> = new Set([
  "auth",
  "campaignReport",
  "common",
  "contact",
  "errors",
  "landing",
  "nav",
  "publicNav",
  "rateCard",
  "status",
]);

type Messages = Record<string, unknown>;

export function pickClientMessages(all: Messages, { signedIn }: { signedIn: boolean }): Messages {
  const out: Messages = {};
  for (const [ns, spec] of Object.entries(CLIENT_MESSAGES)) {
    if (!signedIn && !PUBLIC_CLIENT_NAMESPACES.has(ns)) continue;
    const source = all[ns];
    if (source === undefined) continue;
    if (spec === true) {
      out[ns] = source;
      continue;
    }
    const picked: Messages = {};
    for (const key of spec) {
      const value = (source as Messages)[key];
      if (value !== undefined) picked[key] = value;
    }
    out[ns] = picked;
  }
  return out;
}
