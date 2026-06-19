"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  toggleFavorite,
  addFavoriteToList,
  createFavoriteList,
} from "@/app/favorites-actions";

export type FavListOption = { id: string; name: string };

export function FavoriteButton({
  locale,
  titleId,
  initialFavorited,
  lists,
}: {
  locale: string;
  titleId: string;
  initialFavorited: boolean;
  lists: FavListOption[];
}) {
  const t = useTranslations("favorites");
  const [favorited, setFavorited] = useState(initialFavorited);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Reconcile to server truth after a revalidation re-renders the card.
  useEffect(() => {
    setFavorited(initialFavorited);
  }, [initialFavorited]);

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

  function onAddToList(listId: string) {
    setFavorited(true);
    const fd = new FormData();
    fd.set("locale", locale);
    fd.set("titleId", titleId);
    fd.set("listId", listId);
    startTransition(async () => {
      await addFavoriteToList(fd);
      setMenuOpen(false);
    });
  }

  function onCreateList(formData: FormData) {
    formData.set("locale", locale);
    formData.set("titleId", titleId);
    setFavorited(true);
    startTransition(async () => {
      await createFavoriteList(formData);
      setMenuOpen(false);
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
              {lists.map((l) => (
                <li key={l.id}>
                  <button type="button" role="menuitem" onClick={() => onAddToList(l.id)}>
                    {l.name}
                  </button>
                </li>
              ))}
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
