// Public mega-menu configuration. Only used for guest visitors on
// marketing pages — signed-in users see the role-aware NavShell from
// src/lib/nav.ts. One config drives both desktop dropdowns and mobile
// accordion. Icons are inline SVG identifiers (rendered by
// public-header.tsx) so we don't pull in lucide-react.

export type PublicIcon =
  | "grid"
  | "sparkles"
  | "route"
  | "target"
  | "building"
  | "newspaper"
  | "shield"
  | "mail"
  | "info"
  | "lock"
  | "file"
  | "compass"
  | "handshake";

export type PublicNavMegaItem = {
  id: string;
  titleKey: string;
  descriptionKey: string;
  href: string;
  icon: PublicIcon;
};

export type PublicNavLink = {
  kind: "link";
  id: string;
  labelKey: string;
  href: string;
};

export type PublicNavMega = {
  kind: "mega";
  id: string;
  labelKey: string;
  items: PublicNavMegaItem[];
  featured: {
    titleKey: string;
    descriptionKey: string;
    href: string;
    icon: PublicIcon;
  };
};

export type PublicNavItem = PublicNavLink | PublicNavMega;

export const PUBLIC_NAV_ITEMS: PublicNavItem[] = [
  {
    kind: "mega",
    id: "product",
    labelKey: "product.label",
    items: [
      {
        id: "catalog",
        titleKey: "product.items.catalog.title",
        descriptionKey: "product.items.catalog.description",
        href: "/catalog",
        icon: "grid",
      },
      {
        id: "recommend",
        titleKey: "product.items.recommend.title",
        descriptionKey: "product.items.recommend.description",
        href: "/recommend",
        icon: "sparkles",
      },
      {
        id: "howItWorks",
        titleKey: "product.items.howItWorks.title",
        descriptionKey: "product.items.howItWorks.description",
        href: "/how-it-works",
        icon: "route",
      },
    ],
    featured: {
      titleKey: "product.featured.title",
      descriptionKey: "product.featured.description",
      href: "/catalog",
      icon: "compass",
    },
  },
  {
    kind: "mega",
    id: "solutions",
    labelKey: "solutions.label",
    items: [
      {
        id: "advertisers",
        titleKey: "solutions.items.advertisers.title",
        descriptionKey: "solutions.items.advertisers.description",
        href: "/for-advertisers",
        icon: "target",
      },
      {
        id: "agencies",
        titleKey: "solutions.items.agencies.title",
        descriptionKey: "solutions.items.agencies.description",
        href: "/for-agencies",
        icon: "building",
      },
      {
        id: "publishers",
        titleKey: "solutions.items.publishers.title",
        descriptionKey: "solutions.items.publishers.description",
        href: "/for-publishers",
        icon: "newspaper",
      },
    ],
    featured: {
      titleKey: "solutions.featured.title",
      descriptionKey: "solutions.featured.description",
      href: "/catalog",
      icon: "compass",
    },
  },
  {
    kind: "link",
    id: "pricing",
    labelKey: "pricing.label",
    href: "/pricing",
  },
  {
    kind: "mega",
    id: "resources",
    labelKey: "resources.label",
    items: [
      {
        id: "howItWorks",
        titleKey: "resources.items.howItWorks.title",
        descriptionKey: "resources.items.howItWorks.description",
        href: "/how-it-works",
        icon: "route",
      },
      {
        id: "security",
        titleKey: "resources.items.security.title",
        descriptionKey: "resources.items.security.description",
        href: "/security",
        icon: "shield",
      },
      {
        id: "contact",
        titleKey: "resources.items.contact.title",
        descriptionKey: "resources.items.contact.description",
        href: "/contact",
        icon: "mail",
      },
    ],
    featured: {
      titleKey: "resources.featured.title",
      descriptionKey: "resources.featured.description",
      href: "/for-publishers",
      icon: "handshake",
    },
  },
  {
    kind: "mega",
    id: "company",
    labelKey: "company.label",
    items: [
      {
        id: "about",
        titleKey: "company.items.about.title",
        descriptionKey: "company.items.about.description",
        href: "/about",
        icon: "info",
      },
      {
        id: "contact",
        titleKey: "company.items.contact.title",
        descriptionKey: "company.items.contact.description",
        href: "/contact",
        icon: "mail",
      },
      {
        id: "privacy",
        titleKey: "company.items.privacy.title",
        descriptionKey: "company.items.privacy.description",
        href: "/privacy",
        icon: "lock",
      },
      {
        id: "terms",
        titleKey: "company.items.terms.title",
        descriptionKey: "company.items.terms.description",
        href: "/terms",
        icon: "file",
      },
    ],
    featured: {
      titleKey: "company.featured.title",
      descriptionKey: "company.featured.description",
      href: "/for-publishers",
      icon: "handshake",
    },
  },
];
