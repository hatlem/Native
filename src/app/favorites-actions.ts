"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loadScope } from "@/lib/scope";
import {
  toggleFavorite as toggleFavoriteLib,
  addFavoriteToList as addFavoriteToListLib,
  removeFavoriteFromList as removeFavoriteFromListLib,
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
  if (titleId) await toggleFavoriteLib(scope.userId!, titleId);
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
    await addFavoriteToListLib(scope.userId!, titleId, listId).catch(() => {});
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
    await removeFavoriteFromListLib(scope.userId!, listId, favoriteId).catch(() => {});
  }
  revalidatePath(`/${locale}/favorites`, "page");
}

export async function createFavoriteList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const name = str(formData, "name");
  const titleId = str(formData, "titleId"); // optional: add this title on create
  const scope = await requireUser(locale);
  const orgId = scope.workspace?.activeOrgId ?? null;
  const list = await createFavoriteListLib(scope.userId!, orgId, name || "Untitled list");
  if (titleId) {
    await addFavoriteToListLib(scope.userId!, titleId, list.id).catch(() => {});
  }
  revalidatePath(`/${locale}/catalog`, "page");
  revalidatePath(`/${locale}/favorites`, "page");
}

export async function renameFavoriteList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const name = str(formData, "name");
  const scope = await requireUser(locale);
  if (listId) await renameFavoriteListLib(scope.userId!, listId, name).catch(() => {});
  revalidatePath(`/${locale}/favorites`, "page");
}

export async function deleteFavoriteList(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const scope = await requireUser(locale);
  if (listId) await deleteFavoriteListLib(scope.userId!, listId).catch(() => {});
  redirect(`/${locale}/favorites`);
}

export async function setFavoriteListShared(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const listId = str(formData, "listId");
  const shared = str(formData, "shared") === "1";
  const scope = await requireUser(locale);
  if (listId) await setFavoriteListSharedLib(scope.userId!, listId, shared).catch(() => {});
  revalidatePath(`/${locale}/favorites`, "page");
}
