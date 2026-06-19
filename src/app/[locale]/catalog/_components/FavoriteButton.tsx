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
  /** Ids of the user's lists this title is already in — drives the checkmarks. */
  inListIds?: string[];
}) {
  const t = useTranslations("favorites");
  const [favorited, setFavorited] = useState(initialFavorited);
  const [inLists, setInLists] = useState<Set<string>>(() => new Set(inListIds));
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

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

  // Close the menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  function onToggle() {
    setFavorited((v) => !v); // optimistic
    const fd = new FormData();
    fd.set("locale", locale);
    fd.set("titleId", titleId);
    startTransition(async () => {
      await toggleFavorite(fd);
    });
  }

  // Toggle membership in ONE list. The menu stays open so several lists can be
  // ticked in a row. Adding a list also lights the heart (it's now favorited).
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
      // Keep the menu open; the new (checked) list arrives on revalidation.
    });
  }

  return (
    <div className="fav-btn" ref={wrapRef}>
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
        type="button"
        className="fav-caret"
        aria-label={t("addToList")}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {"▾"}
      </button>
      {menuOpen ? (
        <div className="fav-menu" role="menu">
          <p className="fav-menu-title">{t("addToList")}</p>
          {lists.length > 0 ? (
            <ul>
              {lists.map((l) => {
                const checked = inLists.has(l.id);
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={checked}
                      className={checked ? "is-checked" : undefined}
                      onClick={() => onToggleList(l.id)}
                    >
                      <span className="fav-check" aria-hidden="true">
                        {checked ? "✓" : ""}
                      </span>
                      {l.name}
                    </button>
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
