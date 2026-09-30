"use client";

import { useActionState, useState } from "react";
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
  addFavoriteToCollection,
  setFavoriteListMembership,
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
  collections,
}: {
  locale: string;
  pub: FavoritePublication;
  publishedBy: string;
  // Null for a view-only seat: adding to a plan changes the org's plans.
  addToPlanLabel: string | null;
  removeMode: RemoveMode;
  removeLabel?: string;
  listId?: string;
  // The viewer's own collections, offered as "Add to collection" — the only
  // way a favorite gets into one (the catalog heart's menu adds to saved
  // lists, i.e. plans). Omitted inside a collection view.
  collections?: { options: { id: string; name: string }[] };
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
        {addToPlanLabel ? (
          <form action={saveTitleToList}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="titleId" value={pub.titleId} />
            <button type="submit" className="btn ghost small">{addToPlanLabel}</button>
          </form>
        ) : null}
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
      {collections && collections.options.length > 0 ? (
        <CollectionControl locale={locale} pub={pub} options={collections.options} />
      ) : null}
    </article>
  );
}

// A favorite's collections on its card: which ones it is already in (each
// removable), and "Add to collection" offering only the others, with a line
// that says what the add did. Adding used to show every collection, the
// card never said where a favorite already was, and a repeat add silently
// did nothing.
function CollectionControl({
  locale,
  pub,
  options,
}: {
  locale: string;
  pub: FavoritePublication;
  options: { id: string; name: string }[];
}) {
  const t = useTranslations("favorites");
  const [state, formAction, pending] = useActionState(addFavoriteToCollection, null);
  const nameOf = (id: string | null) => options.find((o) => o.id === id)?.name ?? "";
  const member = new Set(pub.collectionIds);
  const inCollections = options.filter((o) => member.has(o.id));
  const offered = options.filter((o) => !member.has(o.id));
  return (
    <div className="favorite-collections">
      {inCollections.length > 0 ? (
        <div className="favorite-collections__in">
          <span className="muted small">{t("inCollections")}</span>
          {inCollections.map((c) => (
            <form key={c.id} action={setFavoriteListMembership} className="favorite-collections__chip">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="titleId" value={pub.titleId} />
              <input type="hidden" name="listId" value={c.id} />
              <input type="hidden" name="member" value="0" />
              <span>{c.name}</span>
              <button type="submit" aria-label={t("removeFromCollection", { name: c.name })}>
                ×
              </button>
            </form>
          ))}
        </div>
      ) : null}
      {offered.length > 0 ? (
        <form action={formAction} className="cluster tight">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="titleId" value={pub.titleId} />
          <select
            name="listId"
            aria-label={t("addToCollection")}
            // Re-keyed when the offered set changes, so the default is always
            // a collection it isn't in yet.
            key={offered.map((o) => o.id).join(",")}
            defaultValue={offered[0].id}
            style={{ width: "auto", minWidth: 0, flex: "1 1 140px" }}
          >
            {offered.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn ghost small" disabled={pending}>
            {t("addToCollectionSubmit")}
          </button>
        </form>
      ) : (
        <p className="muted small">{t("inAllCollections")}</p>
      )}
      {/* "Added to X" only while it is still in X: removing it from the
          chip afterwards must not leave a stale confirmation behind. */}
      {state && (state.outcome === "unavailable" || (state.listId && member.has(state.listId))) ? (
        <p
          className={`favorite-collections__status${state.outcome === "unavailable" ? " is-error" : ""}`}
          role="status"
        >
          {state.outcome === "added"
            ? t("addedToCollection", { name: nameOf(state.listId) })
            : state.outcome === "already"
              ? t("alreadyInCollection", { name: nameOf(state.listId) })
              : t("collectionAddFailed")}
        </p>
      ) : null}
    </div>
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
  readOnly = false,
}: {
  locale: string;
  favorites: FavoritePublication[];
  lists: FavoriteListSummary[];
  sharedLists: FavoriteListSummary[];
  openList: FavoriteListDetail | null;
  listUnavailable?: boolean;
  // View-only (RESTRICTED) seat: favorites and collections stay personal and
  // editable, but "Add to plan" and sharing with the team are left out.
  readOnly?: boolean;
}) {
  const t = useTranslations("favorites");
  const tc = useTranslations("catalog");
  const addToPlanLabel = readOnly ? null : tc("savePublication");
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
          <span>{t("collectionUnavailable")}</span>
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
                collections={{ options: lists.map((l) => ({ id: l.id, name: l.name })) }}
              />
            ))}
          </div>
        )}
      </div>

      {/* "Collections", not "lists": the catalog heart's "Add to a list" menu
          adds to SAVED lists (plans), and both used to be called "lists" with
          the same "Create list" button — while nothing could ever put a
          favorite into one of these. They now have their own name and an
          "Add to collection" control on every favorite above. */}
      <div>
        <h2>{t("collectionsHeading")}</h2>
        <p className="muted">{t("collectionsLead")}</p>
        <form action={createFavoriteList} className="cluster" style={{ gap: 6, marginBottom: 12 }}>
          <input type="hidden" name="locale" value={locale} />
          <input
            name="name"
            placeholder={t("newCollectionPlaceholder")}
            aria-label={t("newCollectionPlaceholder")}
            maxLength={80}
            required
          />
          <button type="submit" className="btn ghost small">{t("createCollection")}</button>
        </form>
        {lists.length === 0 ? (
          <p className="muted">{t("noCollections")}</p>
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
                  {l.organizationId && !readOnly ? (
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
                    label={t("deleteCollection")}
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
          <h2>{t("sharedCollectionsHeading")}</h2>
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
