"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { BrandWordmark } from "@/app/brand";
import { PUBLIC_NAV_ITEMS } from "@/lib/public-nav";
import { DrawerSection } from "@/app/public-header-drawer";
import { MegaPanel } from "@/app/public-header-mega";
import {
  BackIcon,
  Chevron,
  ChevronRight,
  CloseIcon,
  MenuIcon,
} from "@/app/public-header-icons";

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
