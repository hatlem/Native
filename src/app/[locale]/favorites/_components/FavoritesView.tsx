"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  renameFavoriteList,
  deleteFavoriteList,
  setFavoriteListShared,
  removeFavoriteFromList,
  toggleFavorite,
  createFavoriteList,
} from "@/app/favorites-actions";
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

function PubCard({
  locale,
  pub,
  listId,
  removeLabel,
  publishedBy,
}: {
  locale: string;
  pub: FavoritePublication;
  listId?: string;
  removeLabel: string;
  publishedBy: string;
}) {
  return (
    <article className="card">
      <h3 style={{ margin: 0 }}>
        <Link className="card-link" href={`/catalog/${pub.slug}`}>
          {pub.titleName}
        </Link>
      </h3>
      <div className="muted">{publishedBy}</div>
      <div className="cluster" style={{ marginTop: 8, gap: 6 }}>
        {listId ? (
          <form action={removeFavoriteFromList}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="listId" value={listId} />
            <input type="hidden" name="favoriteId" value={pub.favoriteId} />
            <button type="submit" className="btn ghost small">{removeLabel}</button>
          </form>
        ) : (
          <form action={toggleFavorite}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="titleId" value={pub.titleId} />
            <button type="submit" className="btn ghost small">{removeLabel}</button>
          </form>
        )}
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

export function FavoritesView({
  locale,
  favorites,
  lists,
  sharedLists,
  openList,
}: {
  locale: string;
  favorites: FavoritePublication[];
  lists: FavoriteListSummary[];
  sharedLists: FavoriteListSummary[];
  openList: FavoriteListDetail | null;
}) {
  const t = useTranslations("favorites");
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
        {openList.items.length === 0 ? (
          <p className="muted">{t("itemCount", { count: 0 })}</p>
        ) : (
          <div className="grid">
            {openList.items.map((pub) => (
              <PubCard
                key={pub.favoriteId}
                locale={locale}
                pub={pub}
                listId={openList.isOwner ? openList.id : undefined}
                removeLabel={t("removeFromList")}
                publishedBy={publishedBy(pub)}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section style={{ display: "grid", gap: 28 }}>
      <div>
        <h2>{t("allHeading")}</h2>
        {favorites.length === 0 ? (
          <div className="empty-state">
            <p className="muted">{t("empty")}</p>
            <Link href="/catalog" className="btn">{t("browseCta")}</Link>
          </div>
        ) : (
          <div className="grid">
            {favorites.map((pub) => (
              <PubCard
                key={pub.favoriteId}
                locale={locale}
                pub={pub}
                removeLabel={t("remove")}
                publishedBy={publishedBy(pub)}
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
                  <form action={setFavoriteListShared}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="listId" value={l.id} />
                    <input type="hidden" name="shared" value={l.sharedWithOrg ? "0" : "1"} />
                    <button type="submit" className="btn ghost small">
                      {l.sharedWithOrg ? t("unshare") : t("share")}
                    </button>
                  </form>
                  <RenameForm locale={locale} listId={l.id} current={l.name} label={t("rename")} />
                  <form action={deleteFavoriteList}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="listId" value={l.id} />
                    <button type="submit" className="btn ghost small">{t("delete")}</button>
                  </form>
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
