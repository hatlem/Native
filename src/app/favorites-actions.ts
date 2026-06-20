"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loadScope } from "@/lib/scope";
import {
  toggleFavorite as toggleFavoriteLib,
  addFavoriteToList as addFavoriteToListLib,
  removeFavoriteFromList as removeFavoriteFromListLib,
  removeFavoriteFromListByTitle as removeFavoriteFromListByTitleLib,
  createFavoriteList as createFavoriteListLib,
  renameFavoriteList as renameFavoriteListLib,
  deleteFavoriteList as deleteFavoriteListLib,
  setFavoriteListShared as setFavoriteListSharedLib,
} from "@/lib/favorites";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Resolve the signed-in user, redirecting to sign-in if absent. */
async function requireUser(locale: string) {
  const scope = await loadScope();
  if (!scope.userId) redirect(`/${locale}/signin`);
  return scope;
}

export async function toggleFavorite(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const titleId = str(formData, "titleId");
  const scope = await requireUser(locale);
  if (titleId)
    await toggleFavoriteLib(scope.userId!, titleId).catch((e) =>
      console.error("favorites.toggle_failed", e),
    );
  // Revalidate wherever a heart may render. `page` form keeps it cheap.
  revalidatePath(`/${locale}/catalog`, "page");
  revalidatePath(`/${locale}/favorites`, "page");
}

export async function addFavoriteToList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const titleId = str(formData, "titleId");
  const listId = str(formData, "listId");
  const scope = await requireUser(locale);
  if (titleId && listId) {
    // The lib throws on a forged/foreign listId (requireOwnList). Swallow it so
    // the action is a silent no-op rather than a 500/leak — but LOG it, so a
    // genuine failure (DB error, etc.) is observable instead of vanishing. Same
    // rationale for every list-mutation catch below.
    await addFavoriteToListLib(scope.userId!, titleId, listId).catch((e) =>
      console.error("favorites.add_to_list_failed", e),
    );
  }
  revalidatePath(`/${locale}/catalog`, "page");
  revalidatePath(`/${locale}/favorites`, "page");
}

// Toggle a publication's membership in one list, addressed by titleId (the card
// checklist knows the title + the desired state). member="1" adds (creating the
// heart if needed), member="0" removes from that list while keeping the heart.
// Lets a buyer put the same publication in several lists from the card.
export async function setFavoriteListMembership(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const titleId = str(formData, "titleId");
  const listId = str(formData, "listId");
  const member = str(formData, "member") === "1";
  const scope = await requireUser(locale);
  if (titleId && listId) {
    const op = member
      ? addFavoriteToListLib(scope.userId!, titleId, listId)
      : removeFavoriteFromListByTitleLib(scope.userId!, titleId, listId);
    await op.catch((e) => console.error("favorites.set_membership_failed", e));
  }
  revalidatePath(`/${locale}/catalog`, "page");
  revalidatePath(`/${locale}/favorites`, "page");
}

export async function removeFavoriteFromList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const favoriteId = str(formData, "favoriteId");
  const scope = await requireUser(locale);
  if (listId && favoriteId) {
    await removeFavoriteFromListLib(scope.userId!, listId, favoriteId).catch((e) =>
      console.error("favorites.remove_from_list_failed", e),
    );
  }
  revalidatePath(`/${locale}/favorites`, "page");
}

export async function createFavoriteList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const name = str(formData, "name");
  const titleId = str(formData, "titleId"); // optional: add this title on create
  const scope = await requireUser(locale);
  // Share scope is the user's OWN team (home org), never the volatile selected
  // client — otherwise an agency user's list would land under the client org.
  const orgId = scope.workspace?.homeOrgId ?? null;
  const list = await createFavoriteListLib(scope.userId!, orgId, name || "Untitled list");
  if (titleId) {
    await addFavoriteToListLib(scope.userId!, titleId, list.id).catch((e) =>
      console.error("favorites.create_list_add_failed", e),
    );
  }
  revalidatePath(`/${locale}/catalog`, "page");
  revalidatePath(`/${locale}/favorites`, "page");
}

export async function renameFavoriteList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const name = str(formData, "name");
  const scope = await requireUser(locale);
  if (listId)
    await renameFavoriteListLib(scope.userId!, listId, name).catch((e) =>
      console.error("favorites.rename_list_failed", e),
    );
  revalidatePath(`/${locale}/favorites`, "page");
}

export async function deleteFavoriteList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const scope = await requireUser(locale);
  if (listId)
    await deleteFavoriteListLib(scope.userId!, listId).catch((e) =>
      console.error("favorites.delete_list_failed", e),
    );
  redirect(`/${locale}/favorites`);
}

export async function setFavoriteListShared(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const shared = str(formData, "shared") === "1";
  const scope = await requireUser(locale);
  if (listId)
    await setFavoriteListSharedLib(scope.userId!, listId, shared).catch((e) =>
      console.error("favorites.set_shared_failed", e),
    );
  revalidatePath(`/${locale}/favorites`, "page");
}
