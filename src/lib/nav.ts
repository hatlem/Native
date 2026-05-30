// Role-aware navigation. Returns at most 5–7 visible top-level items per
// audience so the header never becomes a link dump. Detail pages and
// secondary destinations are reachable through the command palette
// (Cmd+K) and the user menu, not the top bar.

export type NavItem = {
  key: string;
  label: string;
  href: string;
  description?: string;
};

export type Audience =
  | "public"
  | "advertiser"
  | "agency"
  | "publisher"
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
  if (role === "DESK" || role === "CONTENT") return "desk";
  if (role === "SUPERADMIN") return "superadmin";
  if (session?.user?.orgType === "AGENCY") return "agency";
  return "advertiser";
}

export function navItemsFor(
  audience: Audience,
  t: (key: string) => string,
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
      return [
        { key: "catalog", label: t("catalog"), href: "/catalog" },
        { key: "plan", label: t("plan"), href: "/plan" },
        { key: "requests", label: t("requests"), href: "/requests" },
        { key: "orders", label: t("orders"), href: "/orders" },
        { key: "reports", label: t("reports"), href: "/reports" },
      ];
    case "agency":
      return [
        { key: "catalog", label: t("catalog"), href: "/catalog" },
        { key: "plan", label: t("plan"), href: "/plan" },
        { key: "agency", label: t("agency"), href: "/agency" },
        { key: "requests", label: t("requests"), href: "/requests" },
        { key: "orders", label: t("orders"), href: "/orders" },
        { key: "reports", label: t("reports"), href: "/reports" },
      ];
    case "publisher":
      return [
        { key: "publisher", label: t("publisher"), href: "/publisher" },
        { key: "publisherOrders", label: t("orders"), href: "/publisher/orders" },
        { key: "availability", label: t("availability"), href: "/publisher/availability" },
      ];
    case "desk":
      return [
        { key: "desk", label: t("desk"), href: "/desk" },
        { key: "deskOrders", label: t("orders"), href: "/desk/orders" },
        { key: "deskContentFees", label: t("contentFees"), href: "/desk/content-fees" },
        { key: "deskReports", label: t("reports"), href: "/desk/reports" },
      ];
    case "superadmin":
      return [
        { key: "desk", label: t("desk"), href: "/desk" },
        { key: "deskOrders", label: t("orders"), href: "/desk/orders" },
        { key: "deskTitles", label: t("titles"), href: "/desk/titles" },
        { key: "deskContentFees", label: t("contentFees"), href: "/desk/content-fees" },
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
): { section: string; items: NavItem[] }[] {
  const goWork: NavItem[] = (() => {
    switch (audience) {
      case "advertiser":
      case "agency":
        return [
          { key: "catalog", label: t("catalog"), href: "/catalog" },
          { key: "plan", label: t("plan"), href: "/plan" },
          { key: "recommend", label: t("recommend"), href: "/recommend" },
          { key: "requests", label: t("requests"), href: "/requests" },
          { key: "orders", label: t("orders"), href: "/orders" },
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
          { key: "availability", label: t("availability"), href: "/publisher/availability" },
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
