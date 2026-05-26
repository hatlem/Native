"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { BrandWordmark } from "@/app/brand";
import { PUBLIC_NAV_ITEMS, type PublicIcon, type PublicNavMega } from "@/lib/public-nav";

type Props = {
  brand: string;
  authActions: { signIn: string; signUp: string };
};

function normalizePath(p: string): string {
  return p.replace(/\/+$/, "") || "/";
}

function isActive(pathname: string, href: string): boolean {
  const a = normalizePath(pathname);
  const b = normalizePath(href);
  if (b === "/") return a === "/";
  return a === b || a.startsWith(b + "/");
}

export function PublicHeader({ brand, authActions }: Props) {
  const t = useTranslations("publicNav");
  const tNav = useTranslations("nav");
  const pathname = usePathname();
  const [openMega, setOpenMega] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSection, setDrawerSection] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  const labels = {
    skip: tNav("skipToContent"),
    menu: tNav("menu"),
    close: tNav("close"),
    back: t("actions.back"),
  };

  const closeMega = useCallback(() => setOpenMega(null), []);
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setDrawerSection(null);
  }, []);

  // Close menus on navigation.
  useEffect(() => {
    closeMega();
    closeDrawer();
  }, [pathname, closeMega, closeDrawer]);

  // Click outside closes the desktop mega panel.
  useEffect(() => {
    if (!openMega) return;
    const handler = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        closeMega();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMega, closeMega]);

  // Escape closes whichever surface is open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (drawerOpen) closeDrawer();
      else if (openMega) closeMega();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drawerOpen, openMega, closeDrawer, closeMega]);

  // Lock body scroll while drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  return (
    <>
      <a href="#main" className="skip-link">
        {labels.skip}
      </a>

      <header className="site-header public-header">
        <div className="container">
          <Link href="/" className="brand" aria-label={brand}>
            <BrandWordmark className="brand-wordmark" aria-label={brand} />
          </Link>

          <nav
            ref={navRef}
            className="nav-mega"
            aria-label="Primary"
          >
            {PUBLIC_NAV_ITEMS.map((item) => {
              if (item.kind === "link") {
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="nav-mega-link"
                    aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  >
                    {t(item.labelKey)}
                  </Link>
                );
              }
              const open = openMega === item.id;
              return (
                <div key={item.id} className="nav-mega-group">
                  <button
                    type="button"
                    className="nav-mega-trigger"
                    aria-expanded={open}
                    aria-haspopup="menu"
                    aria-controls={`mega-${item.id}`}
                    onClick={() => setOpenMega(open ? null : item.id)}
                  >
                    {t(item.labelKey)}
                    <Chevron open={open} />
                  </button>
                  {open ? (
                    <MegaPanel id={`mega-${item.id}`} item={item} t={t} onClose={closeMega} />
                  ) : null}
                </div>
              );
            })}
          </nav>

          <div className="nav-actions">
            <Link href="/signin" className="btn ghost small">
              {authActions.signIn}
            </Link>
            <Link href="/signup" className="btn small">
              {authActions.signUp}
            </Link>
            <button
              type="button"
              className="icon-btn menu-toggle"
              aria-label={labels.menu}
              aria-pressed={drawerOpen}
              onClick={() => setDrawerOpen((v) => !v)}
            >
              <MenuIcon />
            </button>
          </div>
        </div>
      </header>

      <div
        className="drawer"
        data-open={drawerOpen}
        aria-hidden={!drawerOpen}
      >
        <div className="scrim" onClick={closeDrawer} />
        <aside className="sheet" aria-label="Menu">
          <div className="head">
            {drawerSection ? (
              <button
                type="button"
                className="icon-btn"
                aria-label={labels.back}
                onClick={() => setDrawerSection(null)}
              >
                <BackIcon />
              </button>
            ) : (
              <Link href="/" className="brand" onClick={closeDrawer}>
                <BrandWordmark className="brand-wordmark" aria-label={brand} />
              </Link>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label={labels.close}
              onClick={closeDrawer}
            >
              <CloseIcon />
            </button>
          </div>

          {drawerSection ? (
            <DrawerSection
              section={drawerSection}
              t={t}
              onClose={closeDrawer}
            />
          ) : (
            <nav aria-label="Mobile" className="drawer-top">
              {PUBLIC_NAV_ITEMS.map((item) => {
                if (item.kind === "link") {
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className="drawer-link"
                      onClick={closeDrawer}
                      aria-current={isActive(pathname, item.href) ? "page" : undefined}
                    >
                      {t(item.labelKey)}
                    </Link>
                  );
                }
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="drawer-link drawer-section-btn"
                    onClick={() => setDrawerSection(item.id)}
                    aria-label={t("actions.openSubmenu", { label: t(item.labelKey) })}
                  >
                    <span>{t(item.labelKey)}</span>
                    <ChevronRight />
                  </button>
                );
              })}
              <div className="drawer-cta">
                <Link href="/signin" className="btn secondary block" onClick={closeDrawer}>
                  {authActions.signIn}
                </Link>
                <Link href="/signup" className="btn block" onClick={closeDrawer}>
                  {authActions.signUp}
                </Link>
              </div>
            </nav>
          )}
        </aside>
      </div>
    </>
  );
}

function DrawerSection({
  section,
  t,
  onClose,
}: {
  section: string;
  t: (key: string) => string;
  onClose: () => void;
}) {
  const item = PUBLIC_NAV_ITEMS.find(
    (x) => x.kind === "mega" && x.id === section,
  ) as PublicNavMega | undefined;
  if (!item) return null;
  return (
    <div className="drawer-mega">
      <div className="drawer-mega-label">{t(item.labelKey)}</div>
      <nav className="drawer-mega-list" aria-label={t(item.labelKey)}>
        {item.items.map((entry) => (
          <Link
            key={entry.id}
            href={entry.href}
            className="drawer-mega-item"
            onClick={onClose}
          >
            <Icon name={entry.icon} />
            <span className="drawer-mega-text">
              <span className="drawer-mega-title">{t(entry.titleKey)}</span>
              <span className="drawer-mega-desc">{t(entry.descriptionKey)}</span>
            </span>
          </Link>
        ))}
      </nav>
      <Link
        href={item.featured.href}
        className="drawer-mega-featured"
        onClick={onClose}
      >
        <div className="drawer-mega-featured-icon">
          <Icon name={item.featured.icon} />
        </div>
        <div className="drawer-mega-featured-text">
          <div className="drawer-mega-featured-title">
            {t(item.featured.titleKey)}
            <ArrowRight />
          </div>
          <div className="drawer-mega-featured-desc">
            {t(item.featured.descriptionKey)}
          </div>
        </div>
      </Link>
    </div>
  );
}

function MegaPanel({
  id,
  item,
  t,
  onClose,
}: {
  id: string;
  item: PublicNavMega;
  t: (key: string) => string;
  onClose: () => void;
}) {
  return (
    <div className="mega-panel" id={id} role="menu">
      <div className="mega-grid">
        {item.items.map((entry) => (
          <Link
            key={entry.id}
            href={entry.href}
            role="menuitem"
            className="mega-item"
            onClick={onClose}
          >
            <Icon name={entry.icon} className="mega-item-icon" />
            <span className="mega-item-text">
              <span className="mega-item-title">{t(entry.titleKey)}</span>
              <span className="mega-item-desc">{t(entry.descriptionKey)}</span>
            </span>
          </Link>
        ))}
      </div>
      <Link
        href={item.featured.href}
        role="menuitem"
        className="mega-featured"
        onClick={onClose}
      >
        <div className="mega-featured-icon">
          <Icon name={item.featured.icon} />
        </div>
        <div className="mega-featured-text">
          <div className="mega-featured-title">
            {t(item.featured.titleKey)}
            <ArrowRight />
          </div>
          <div className="mega-featured-desc">
            {t(item.featured.descriptionKey)}
          </div>
        </div>
      </Link>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`nav-mega-chev${open ? " open" : ""}`}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg
      className="mega-arrow"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18 9 12l6-6" />
    </svg>
  );
}

function Icon({ name, className }: { name: PublicIcon; className?: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    className,
  };
  switch (name) {
    case "grid":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...common}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l2.8 2.8M15.7 15.7l2.8 2.8M5.5 18.5l2.8-2.8M15.7 8.3l2.8-2.8" />
        </svg>
      );
    case "route":
      return (
        <svg {...common}>
          <circle cx="6" cy="19" r="3" />
          <circle cx="18" cy="5" r="3" />
          <path d="M9 19h6a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h6" />
        </svg>
      );
    case "target":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        </svg>
      );
    case "building":
      return (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="18" rx="1.5" />
          <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3" />
        </svg>
      );
    case "newspaper":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="1.5" />
          <path d="M7 9h6M7 13h10M7 17h10" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3 4 6v6c0 4.6 3.4 8.4 8 9 4.6-.6 8-4.4 8-9V6l-8-3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "mail":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      );
    case "info":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01M11 12h1v5h1" />
        </svg>
      );
    case "lock":
      return (
        <svg {...common}>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      );
    case "file":
      return (
        <svg {...common}>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
          <path d="M14 3v6h6M8 13h8M8 17h6" />
        </svg>
      );
    case "compass":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m15 9-2 6-6 2 2-6 6-2Z" />
        </svg>
      );
    case "handshake":
      return (
        <svg {...common}>
          <path d="M11 17h2.5l3.5-3.5L21 17l-3 3-3-1.5L13 20h-2l-3.5-3.5L4 13l3-3 3 1.5L11 11Z" />
          <path d="M8 8 5 5M16 8l3-3" />
        </svg>
      );
  }
}
