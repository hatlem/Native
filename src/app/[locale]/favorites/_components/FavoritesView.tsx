"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { EmptyState } from "@/app/empty-state";
import {
  renameFavoriteList,
  deleteFavoriteList,
  setFavoriteListShared,
  removeFavoriteFromList,
  toggleFavorite,
  createFavoriteList,
} from "@/app/favorites-actions";
import { saveTitleToList } from "@/app/list-actions";
import type {
  FavoritePublication,
  FavoriteListSummary,
  FavoriteListDetail,
} from "@/lib/favorites";

const UL_RESET: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "grid",
  gap: 8,
};

type RemoveMode = "list" | "heart" | null;

function PubCard({
  locale,
  pub,
  publishedBy,
  addToPlanLabel,
  removeMode,
  removeLabel,
  listId,
}: {
  locale: string;
  pub: FavoritePublication;
  publishedBy: string;
  addToPlanLabel: string;
  removeMode: RemoveMode;
  removeLabel?: string;
  listId?: string;
}) {
  return (
    <article className="card">
      <h3 style={{ margin: 0 }}>
        <Link className="card-link" href={`/catalog/${pub.slug}`}>
          {pub.titleName}
        </Link>
      </h3>
      <div className="muted">{publishedBy}</div>
      <div className="cluster" style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
        {/* A per-viewer buying action — adds the publication to the viewer's own
            plan for desk pricing. Works even from a teammate's read-only list. */}
        <form action={saveTitleToList}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="titleId" value={pub.titleId} />
          <button type="submit" className="btn ghost small">{addToPlanLabel}</button>
        </form>
        {removeMode === "list" && listId ? (
          <form action={removeFavoriteFromList}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="listId" value={listId} />
            <input type="hidden" name="favoriteId" value={pub.favoriteId} />
            <button type="submit" className="btn ghost small">{removeLabel}</button>
          </form>
        ) : removeMode === "heart" ? (
          <form action={toggleFavorite}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="titleId" value={pub.titleId} />
            <button type="submit" className="btn ghost small">{removeLabel}</button>
          </form>
        ) : null}
      </div>
    </article>
  );
}

function RenameForm({
  locale,
  listId,
  current,
  label,
}: {
  locale: string;
  listId: string;
  current: string;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button type="button" className="btn ghost small" onClick={() => setEditing(true)}>
        {label}
      </button>
    );
  }
  return (
    <form action={renameFavoriteList} className="cluster" style={{ gap: 4 }}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="listId" value={listId} />
      <input name="name" defaultValue={current} maxLength={80} required />
      <button type="submit" className="btn ghost small">{label}</button>
    </form>
  );
}

function DeleteListForm({
  locale,
  listId,
  label,
  confirmLabel,
  cancelLabel,
}: {
  locale: string;
  listId: string;
  label: string;
  confirmLabel: string;
  cancelLabel: string;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className="btn ghost small" onClick={() => setConfirming(true)}>
        {label}
      </button>
    );
  }
  // Two-step: deleting a list (and its memberships) is irreversible, so make
  // the second click deliberate — mirrors RenameForm's inline-edit pattern.
  return (
    <span className="cluster" style={{ gap: 4 }}>
      <form action={deleteFavoriteList}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="listId" value={listId} />
        <button type="submit" className="btn small danger">{confirmLabel}</button>
      </form>
      <button type="button" className="btn ghost small" onClick={() => setConfirming(false)}>
        {cancelLabel}
      </button>
    </span>
  );
}

export function FavoritesView({
  locale,
  favorites,
  lists,
  sharedLists,
  openList,
  listUnavailable = false,
}: {
  locale: string;
  favorites: FavoritePublication[];
  lists: FavoriteListSummary[];
  sharedLists: FavoriteListSummary[];
  openList: FavoriteListDetail | null;
  listUnavailable?: boolean;
}) {
  const t = useTranslations("favorites");
  const tc = useTranslations("catalog");
  const addToPlanLabel = tc("savePublication");
  const publishedBy = (pub: FavoritePublication) =>
    t("publishedBy", { publisher: pub.publisherName, market: pub.marketCode });

  // List-detail view (one open list).
  if (openList) {
    return (
      <section>
        <p>
          <Link href="/favorites">← {t("title")}</Link>
        </p>
        <h1>
          {openList.name}
          {openList.sharedWithOrg ? ` · ${t("sharedBadge")}` : ""}
        </h1>
        {!openList.isOwner ? (
          <p className="note">
            {t("sharedByReadOnly", { owner: openList.ownerName ?? "—" })}
          </p>
        ) : null}
        {openList.items.length === 0 ? (
          <p className="muted">{t("itemCount", { count: 0 })}</p>
        ) : (
          <div className="grid">
            {openList.items.map((pub) => (
              <PubCard
                key={pub.favoriteId}
                locale={locale}
                pub={pub}
                publishedBy={publishedBy(pub)}
                addToPlanLabel={addToPlanLabel}
                removeMode={openList.isOwner ? "list" : null}
                removeLabel={t("removeFromList")}
                listId={openList.id}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section style={{ display: "grid", gap: 28 }}>
      {listUnavailable ? (
        <div className="banner-info" role="status">
          <span>{t("listUnavailable")}</span>
        </div>
      ) : null}

      <div>
        <h2>
          {t("allHeading")}
          {favorites.length > 0 ? ` (${favorites.length})` : ""}
        </h2>
        {favorites.length === 0 ? (
          <EmptyState
            title={t("empty")}
            primaryHref="/catalog"
            primaryLabel={t("browseCta")}
          />
        ) : (
          <div className="grid">
            {favorites.map((pub) => (
              <PubCard
                key={pub.favoriteId}
                locale={locale}
                pub={pub}
                publishedBy={publishedBy(pub)}
                addToPlanLabel={addToPlanLabel}
                removeMode="heart"
                removeLabel={t("remove")}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2>{t("listsHeading")}</h2>
        <form action={createFavoriteList} className="cluster" style={{ gap: 6, marginBottom: 12 }}>
          <input type="hidden" name="locale" value={locale} />
          <input
            name="name"
            placeholder={t("newListPlaceholder")}
            aria-label={t("newListPlaceholder")}
            maxLength={80}
            required
          />
          <button type="submit" className="btn ghost small">{t("createList")}</button>
        </form>
        {lists.length === 0 ? (
          <p className="muted">{t("noLists")}</p>
        ) : (
          <ul style={UL_RESET}>
            {lists.map((l) => (
              <li key={l.id} className="card" style={{ display: "grid", gap: 8 }}>
                <Link href={`/favorites?list=${l.id}`}>
                  <strong>{l.name}</strong> · {t("itemCount", { count: l.itemCount })}
                  {l.sharedWithOrg ? ` · ${t("sharedBadge")}` : ""}
                </Link>
                <div className="cluster" style={{ gap: 6, flexWrap: "wrap" }}>
                  {/* Sharing needs a home org to share within; hide the toggle
                      entirely for a no-org list rather than offer a dead no-op. */}
                  {l.organizationId ? (
                    <form action={setFavoriteListShared}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="listId" value={l.id} />
                      <input type="hidden" name="shared" value={l.sharedWithOrg ? "0" : "1"} />
                      <button type="submit" className="btn ghost small">
                        {l.sharedWithOrg ? t("unshare") : t("share")}
                      </button>
                    </form>
                  ) : null}
                  <RenameForm locale={locale} listId={l.id} current={l.name} label={t("rename")} />
                  <DeleteListForm
                    locale={locale}
                    listId={l.id}
                    label={t("delete")}
                    confirmLabel={t("confirmDelete")}
                    cancelLabel={t("cancelDelete")}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {sharedLists.length > 0 ? (
        <div>
          <h2>{t("sharedHeading")}</h2>
          <ul style={UL_RESET}>
            {sharedLists.map((l) => (
              <li key={l.id} className="card">
                <Link href={`/favorites?list=${l.id}`}>
                  <strong>{l.name}</strong> · {t("itemCount", { count: l.itemCount })}
                  {l.ownerName ? ` · ${t("byOwner", { owner: l.ownerName })}` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
