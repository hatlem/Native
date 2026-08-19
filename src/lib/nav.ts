// Role-aware navigation. Returns at most 5–7 visible top-level items per
// audience so the header never becomes a link dump. Detail pages and
// secondary destinations are reachable through the command palette
// (Cmd+K) and the user menu, not the top bar.

export type NavItem = {
  key: string;
  label: string;
  href: string;
  description?: string;
  // Small count pill next to the label — e.g. unsent draft lists on
  // "Kampanjer" — set by the caller (layout.tsx), not computed here.
  badge?: number;
};

export type Audience =
  | "public"
  | "advertiser"
  | "agency"
  | "publisher"
  | "writer"
  | "desk"
  | "superadmin";

type SessionShape = {
  user?: {
    role?: string;
    orgType?: string | null;
    orgId?: string | null;
  };
};

export function audienceFor(session: SessionShape | null | undefined): Audience {
  const role = session?.user?.role;
  if (!role) return "public";
  if (role === "PUBLISHER") return "publisher";
  if (role === "CONTENT") return "writer";
  if (role === "DESK") return "desk";
  if (role === "SUPERADMIN") return "superadmin";
  if (session?.user?.orgType === "AGENCY") return "agency";
  return "advertiser";
}

export type NavOptions = {
  campaignFlow?: boolean;
  // True when a DESK/SUPERADMIN user also holds an active org Membership
  // (e.g. an agency staffer helping a client build their plan directly).
  // Without this, the buyer flow is unreachable from a staff session: it's
  // absent from both the desk top nav and, by default, the palette too.
  hasOrgAccess?: boolean;
};

// The guided-flow front door, prepended to the buyer nav when the
// campaignFlow flag is on. During Phase 0 it sits alongside the existing
// items; the full menu cutover happens later (Phase 7).
function campaignItem(t: (key: string) => string): NavItem {
  return { key: "campaign", label: t("campaign"), href: "/campaign" };
}

// The article library — where a buyer/approver/org admin writes or
// uploads the copy for a placement, with or without a booking behind it.
// Buyer-side only: journalists reach their pieces from /writer, and desk
// works out of the order page.
function articlesItem(t: (key: string) => string): NavItem {
  return { key: "articles", label: t("articles"), href: "/articles" };
}

export function navItemsFor(
  audience: Audience,
  t: (key: string) => string,
  opts: NavOptions = {},
): NavItem[] {
  switch (audience) {
    case "public":
      return [
        { key: "catalog", label: t("catalog"), href: "/catalog" },
        { key: "recommend", label: t("recommend"), href: "/recommend" },
        { key: "howItWorks", label: t("howItWorks"), href: "/how-it-works" },
        { key: "for-publishers", label: t("forPublishers"), href: "/for-publishers" },
      ];
    case "advertiser":
      // Campaign-flow cutover: the guided flow is the whole front door. The
      // old 7-item buyer menu collapses to the flow + a "Campaigns" hub for
      // in-flight work; Catalog/Lists/Favorites/Orders/Reports stay reachable
      // via the command palette (paletteItemsFor keeps them all).
      if (opts.campaignFlow) {
        return [
          { key: "home", label: t("home"), href: "/home" },
          campaignItem(t),
          { key: "campaigns", label: t("campaigns"), href: "/requests" },
          articlesItem(t),
        ];
      }
      return [
        { key: "home", label: t("home"), href: "/home" },
        { key: "catalog", label: t("catalog"), href: "/catalog" },
        { key: "plan", label: t("plan"), href: "/plan" },
        { key: "lists", label: t("lists"), href: "/lists", description: t("listsDesc") },
        { key: "favorites", label: t("favorites"), href: "/favorites", description: t("favoritesDesc") },
        { key: "requests", label: t("requests"), href: "/requests" },
        articlesItem(t),
        { key: "reports", label: t("reports"), href: "/reports" },
      ];
    case "agency":
      if (opts.campaignFlow) {
        return [
          { key: "home", label: t("home"), href: "/home" },
          campaignItem(t),
          { key: "campaigns", label: t("campaigns"), href: "/requests" },
          articlesItem(t),
          { key: "agency", label: t("agency"), href: "/agency" },
        ];
      }
      return [
        { key: "home", label: t("home"), href: "/home" },
        { key: "catalog", label: t("catalog"), href: "/catalog" },
        { key: "plan", label: t("plan"), href: "/plan" },
        { key: "lists", label: t("lists"), href: "/lists", description: t("listsDesc") },
        { key: "favorites", label: t("favorites"), href: "/favorites", description: t("favoritesDesc") },
        { key: "agency", label: t("agency"), href: "/agency" },
        { key: "requests", label: t("requests"), href: "/requests" },
        articlesItem(t),
        { key: "reports", label: t("reports"), href: "/reports" },
      ];
    case "publisher":
      return [
        { key: "publisher", label: t("publisher"), href: "/publisher" },
        { key: "publisherOrders", label: t("orders"), href: "/publisher/orders" },
        { key: "publisherRates", label: t("rates"), href: "/publisher/rates" },
        { key: "availability", label: t("availability"), href: "/publisher/availability" },
      ];
    case "writer":
      return [
        { key: "writerAssignments", label: t("orders"), href: "/writer" },
        { key: "writerProfile", label: t("account"), href: "/writer/profile" },
      ];
    case "desk":
      return [
        { key: "desk", label: t("desk"), href: "/desk" },
        { key: "deskOrders", label: t("orders"), href: "/desk/orders" },
        { key: "deskContentFees", label: t("contentFees"), href: "/desk/content-fees" },
        { key: "deskPlaybooks", label: t("playbooks"), href: "/desk/playbooks" },
        { key: "deskWriters", label: t("writers"), href: "/desk/writers" },
        { key: "deskMetricsNeedsContact", label: t("metricsNeedsContact"), href: "/desk/metrics-needs-contact" },
        { key: "deskReports", label: t("reports"), href: "/desk/reports" },
      ];
    case "superadmin":
      return [
        { key: "desk", label: t("desk"), href: "/desk" },
        { key: "deskOrders", label: t("orders"), href: "/desk/orders" },
        { key: "deskTitles", label: t("titles"), href: "/desk/titles" },
        { key: "deskContentFees", label: t("contentFees"), href: "/desk/content-fees" },
        { key: "deskPlaybooks", label: t("playbooks"), href: "/desk/playbooks" },
        { key: "deskWriters", label: t("writers"), href: "/desk/writers" },
        { key: "deskMetricsNeedsContact", label: t("metricsNeedsContact"), href: "/desk/metrics-needs-contact" },
        { key: "deskReports", label: t("reports"), href: "/desk/reports" },
      ];
  }
}

// Items shown in the user menu (signed-in only) — secondary destinations
// that don't belong in the top bar. Empty for guests; the layout never
// renders a user menu for guests anyway.
export function userMenuItemsFor(
  audience: Audience,
  t: (key: string) => string,
): NavItem[] {
  if (audience === "public") return [];
  return [
    { key: "notifications", label: t("notifications"), href: "/notifications" },
    { key: "account", label: t("account"), href: "/account" },
  ];
}

// Items shown in the command palette — broader surface area than the top
// bar, including marketing pages.
export function paletteItemsFor(
  audience: Audience,
  t: (key: string) => string,
  opts: NavOptions = {},
): { section: string; items: NavItem[] }[] {
  const goWork: NavItem[] = (() => {
    switch (audience) {
      case "advertiser":
      case "agency":
        return [
          { key: "home", label: t("home"), href: "/home" },
          ...(opts.campaignFlow ? [campaignItem(t)] : []),
          { key: "catalog", label: t("catalog"), href: "/catalog" },
          { key: "plan", label: t("plan"), href: "/plan" },
          { key: "lists", label: t("lists"), href: "/lists", description: t("listsDesc") },
        { key: "favorites", label: t("favorites"), href: "/favorites", description: t("favoritesDesc") },
          { key: "recommend", label: t("recommend"), href: "/recommend" },
          { key: "requests", label: t("requests"), href: "/requests" },
          articlesItem(t),
          { key: "reports", label: t("reports"), href: "/reports" },
          ...(audience === "agency"
            ? [{ key: "agency", label: t("agency"), href: "/agency" }]
            : []),
          { key: "notifications", label: t("notifications"), href: "/notifications" },
        ];
      case "publisher":
        return [
          { key: "publisher", label: t("publisher"), href: "/publisher" },
          { key: "publisherOrders", label: t("orders"), href: "/publisher/orders" },
          { key: "publisherRates", label: t("rates"), href: "/publisher/rates" },
          { key: "availability", label: t("availability"), href: "/publisher/availability" },
          { key: "notifications", label: t("notifications"), href: "/notifications" },
        ];
      case "writer":
        return [
          { key: "writerAssignments", label: t("orders"), href: "/writer" },
          { key: "writerProfile", label: t("account"), href: "/writer/profile" },
          { key: "notifications", label: t("notifications"), href: "/notifications" },
        ];
      case "desk":
      case "superadmin":
        return [
          { key: "desk", label: t("desk"), href: "/desk" },
          { key: "deskOrders", label: t("orders"), href: "/desk/orders" },
          { key: "deskContentFees", label: t("contentFees"), href: "/desk/content-fees" },
          { key: "deskReports", label: t("reports"), href: "/desk/reports" },
          ...(audience === "superadmin"
            ? [{ key: "deskTitles", label: t("titles"), href: "/desk/titles" }]
            : []),
          { key: "catalog", label: t("catalog"), href: "/catalog" },
          ...(opts.hasOrgAccess
            ? opts.campaignFlow
              ? [campaignItem(t), { key: "campaigns", label: t("campaigns"), href: "/requests" }]
              : [
                  { key: "plan", label: t("plan"), href: "/plan" },
                  { key: "lists", label: t("lists"), href: "/lists", description: t("listsDesc") },
                ]
            : []),
          { key: "notifications", label: t("notifications"), href: "/notifications" },
        ];
      default:
        return [
          { key: "catalog", label: t("catalog"), href: "/catalog" },
          { key: "recommend", label: t("recommend"), href: "/recommend" },
        ];
    }
  })();

  const learn: NavItem[] = [
    { key: "howItWorks", label: t("howItWorks"), href: "/how-it-works" },
    { key: "forAdvertisers", label: t("forAdvertisers"), href: "/for-advertisers" },
    { key: "forAgencies", label: t("forAgencies"), href: "/for-agencies" },
    { key: "forPublishers", label: t("forPublishers"), href: "/for-publishers" },
    { key: "about", label: t("about"), href: "/about" },
  ];

  return [
    { section: t("paletteGo"), items: goWork },
    { section: t("paletteLearn"), items: learn },
  ];
}
