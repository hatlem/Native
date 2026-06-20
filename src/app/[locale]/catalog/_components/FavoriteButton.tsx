"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  toggleFavorite,
  setFavoriteListMembership,
  createFavoriteList,
} from "@/app/favorites-actions";

export type FavListOption = { id: string; name: string };

export function FavoriteButton({
  locale,
  titleId,
  initialFavorited,
  lists,
  inListIds = [],
}: {
  locale: string;
  titleId: string;
  initialFavorited: boolean;
  lists: FavListOption[];
  /** Ids of the user's lists this title is already in — drives the checkboxes. */
  inListIds?: string[];
}) {
  const t = useTranslations("favorites");
  const [favorited, setFavorited] = useState(initialFavorited);
  const [inLists, setInLists] = useState<Set<string>>(() => new Set(inListIds));
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Stable primitive key: the membership array's identity changes every render,
  // so depend on its joined value and rebuild the set from that inside the effect.
  const inListKey = inListIds.join(",");

  // Reconcile to server truth after a revalidation re-renders the card.
  useEffect(() => {
    setFavorited(initialFavorited);
  }, [initialFavorited]);
  useEffect(() => {
    setInLists(new Set(inListKey ? inListKey.split(",") : []));
  }, [inListKey]);

  // Close on outside click; move focus into the popover when it opens.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    menuRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
    caretRef.current?.focus();
  }

  function onToggle() {
    const next = !favorited;
    setFavorited(next);
    // Un-hearting cascades the favorite out of every list server-side; mirror
    // that optimistically so the checkboxes don't show stale memberships.
    if (!next) setInLists(new Set());
    const fd = new FormData();
    fd.set("locale", locale);
    fd.set("titleId", titleId);
    startTransition(async () => {
      await toggleFavorite(fd);
    });
  }

  // Toggle membership in ONE list. The popover stays open so several lists can
  // be ticked in a row. Adding a list also lights the heart (it's now favorited).
  function onToggleList(listId: string) {
    const willBeMember = !inLists.has(listId);
    setInLists((prev) => {
      const next = new Set(prev);
      if (willBeMember) next.add(listId);
      else next.delete(listId);
      return next;
    });
    if (willBeMember) setFavorited(true);
    const fd = new FormData();
    fd.set("locale", locale);
    fd.set("titleId", titleId);
    fd.set("listId", listId);
    fd.set("member", willBeMember ? "1" : "0");
    startTransition(async () => {
      await setFavoriteListMembership(fd);
    });
  }

  function onCreateList(formData: FormData) {
    formData.set("locale", locale);
    formData.set("titleId", titleId);
    setFavorited(true);
    startTransition(async () => {
      await createFavoriteList(formData);
      // Keep the popover open; the new (checked) list arrives on revalidation.
    });
  }

  return (
    <div
      className="fav-btn"
      ref={wrapRef}
      onKeyDown={(e) => {
        if (e.key === "Escape" && menuOpen) {
          e.stopPropagation();
          closeMenu();
        }
      }}
    >
      <button
        type="button"
        className={`fav-heart${favorited ? " is-on" : ""}`}
        aria-pressed={favorited}
        aria-label={favorited ? t("remove") : t("add")}
        title={favorited ? t("remove") : t("add")}
        disabled={pending}
        onClick={onToggle}
      >
        {favorited ? "♥" : "♡"}
      </button>
      <button
        ref={caretRef}
        type="button"
        className="fav-caret"
        aria-label={t("addToList")}
        aria-haspopup="true"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {"▾"}
      </button>
      {menuOpen ? (
        <div className="fav-menu" role="group" aria-label={t("addToList")} ref={menuRef}>
          <p className="fav-menu-title">{t("addToList")}</p>
          {lists.length > 0 ? (
            <ul>
              {lists.map((l) => {
                const checked = inLists.has(l.id);
                return (
                  <li key={l.id}>
                    <label className={`fav-list-opt${checked ? " is-checked" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleList(l.id)}
                      />
                      <span>{l.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted small">{t("noLists")}</p>
          )}
          <form action={onCreateList} className="fav-newlist">
            <input
              name="name"
              placeholder={t("newListPlaceholder")}
              aria-label={t("newListPlaceholder")}
              maxLength={80}
              required
            />
            <button type="submit" className="btn ghost small">
              {t("createList")}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
