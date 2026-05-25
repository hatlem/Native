"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import type { NavItem } from "@/lib/nav";

type PaletteSection = { section: string; items: NavItem[] };

type Props = {
  brand: string;
  nav: NavItem[];
  palette: PaletteSection[];
  user?: {
    email: string;
    initials: string;
    roleLabel: string;
  };
  menuItems: NavItem[];
  signedIn: boolean;
  signOutAction?: React.ReactNode;
  authActions?: { signIn: string; signUp: string };
  labels: {
    skip: string;
    menu: string;
    close: string;
    search: string;
    searchPlaceholder: string;
    noResults: string;
  };
};

function normalizePath(p: string): string {
  return p.replace(/\/+$/, "") || "/";
}

function isActive(pathname: string, href: string): boolean {
  const cleanedPath = normalizePath(pathname);
  const cleanedHref = normalizePath(href);
  if (cleanedHref === "/") return cleanedPath === "/";
  return cleanedPath === cleanedHref || cleanedPath.startsWith(cleanedHref + "/");
}

export function NavShell({
  brand,
  nav,
  palette,
  user,
  menuItems,
  signedIn,
  signOutAction,
  authActions,
  labels,
}: Props) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDetailsElement>(null);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openPalette = useCallback(() => {
    setPaletteOpen(true);
    setPaletteQuery("");
    setPaletteIndex(0);
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    closeDrawer();
    closePalette();
    setUserMenuOpen(false);
  }, [pathname, closeDrawer, closePalette]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (paletteOpen) {
          closePalette();
        } else {
          openPalette();
        }
        return;
      }
      if (e.key === "Escape") {
        if (paletteOpen) closePalette();
        if (drawerOpen) closeDrawer();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [paletteOpen, drawerOpen, openPalette, closePalette, closeDrawer]);

  useEffect(() => {
    if (paletteOpen) {
      const t = setTimeout(() => paletteInputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [paletteOpen]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  useEffect(() => {
    if (drawerOpen || paletteOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [drawerOpen, paletteOpen]);

  const filteredPalette = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    if (!q) return palette;
    return palette
      .map((section) => ({
        section: section.section,
        items: section.items.filter((it) => it.label.toLowerCase().includes(q)),
      }))
      .filter((section) => section.items.length > 0);
  }, [palette, paletteQuery]);

  const flatItems = useMemo(
    () => filteredPalette.flatMap((s) => s.items),
    [filteredPalette],
  );

  return (
    <>
      <a href="#main" className="skip-link">
        {labels.skip}
      </a>

      <header className="site-header">
        <div className="container">
          <Link href="/" className="brand" aria-label={brand}>
            <span className="brand-mark" aria-hidden="true">AT</span>
            <span>{brand}</span>
          </Link>

          <nav className="nav-primary" aria-label="Primary">
            {nav.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="nav-actions">
            {signedIn && user ? (
              <details
                ref={userMenuRef}
                className="user-menu"
                open={userMenuOpen}
                onToggle={(e) => setUserMenuOpen((e.target as HTMLDetailsElement).open)}
              >
                <summary aria-label={user.email}>
                  <span className="avatar" aria-hidden="true">{user.initials}</span>
                </summary>
                <div className="panel">
                  <div className="who">
                    <div className="role">{user.roleLabel}</div>
                    <div className="email">{user.email}</div>
                  </div>
                  {menuItems.map((m) => (
                    <Link key={m.key} href={m.href} className="menu-item">
                      {m.label}
                    </Link>
                  ))}
                  {signOutAction}
                </div>
              </details>
            ) : authActions ? (
              <>
                <Link href="/signin" className="btn ghost small">
                  {authActions.signIn}
                </Link>
                <Link href="/signup" className="btn small">
                  {authActions.signUp}
                </Link>
              </>
            ) : null}

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
            <Link href="/" className="brand" onClick={closeDrawer}>
              <span className="brand-mark" aria-hidden="true">AT</span>
              <span>{brand}</span>
            </Link>
            <button
              type="button"
              className="icon-btn"
              aria-label={labels.close}
              onClick={closeDrawer}
            >
              <CloseIcon />
            </button>
          </div>
          <nav aria-label="Mobile">
            {nav.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                onClick={closeDrawer}
              >
                {item.label}
              </Link>
            ))}
            {signedIn
              ? menuItems.map((m) => (
                  <Link key={m.key} href={m.href} onClick={closeDrawer}>
                    {m.label}
                  </Link>
                ))
              : null}
          </nav>
          <div className="who">
            {signedIn && user ? (
              <>
                <div className="muted" style={{ fontSize: "0.78rem" }}>
                  {user.roleLabel}
                </div>
                <div style={{ fontSize: "0.92rem" }}>{user.email}</div>
                {signOutAction}
              </>
            ) : authActions ? (
              <div className="stack-2">
                <Link href="/signin" className="btn secondary block" onClick={closeDrawer}>
                  {authActions.signIn}
                </Link>
                <Link href="/signup" className="btn block" onClick={closeDrawer}>
                  {authActions.signUp}
                </Link>
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      {paletteOpen ? (
        <div className="cmdk-overlay" onClick={closePalette}>
          <div
            className="cmdk-panel"
            role="dialog"
            aria-modal="true"
            aria-label={labels.search}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={paletteInputRef}
              className="cmdk-input"
              placeholder={labels.searchPlaceholder}
              value={paletteQuery}
              onChange={(e) => {
                setPaletteQuery(e.target.value);
                setPaletteIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setPaletteIndex((i) => Math.min(i + 1, flatItems.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setPaletteIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const target = flatItems[paletteIndex];
                  if (target) {
                    closePalette();
                    window.location.assign(target.href);
                  }
                }
              }}
            />
            <div className="cmdk-results">
              {filteredPalette.length === 0 ? (
                <div className="cmdk-empty">{labels.noResults}</div>
              ) : (
                filteredPalette.map((section) => (
                  <div key={section.section}>
                    <div className="cmdk-section">{section.section}</div>
                    {section.items.map((item) => {
                      const flatIdx = flatItems.indexOf(item);
                      const selected = flatIdx === paletteIndex;
                      return (
                        <Link
                          key={item.key}
                          href={item.href}
                          className="cmdk-item"
                          aria-selected={selected}
                          onMouseEnter={() => setPaletteIndex(flatIdx)}
                          onClick={closePalette}
                        >
                          <span>{item.label}</span>
                          <span className="desc">{item.href}</span>
                        </Link>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
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
