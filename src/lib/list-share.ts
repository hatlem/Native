// Client-share links for saved lists: an agency (or advertiser) shares a
// read-only view of a plan with their client for sign-off — no account, no
// sign-in, just an unguessable URL. The token is 256 bits (same generator as
// the auth tokens), stored plainly (unlike single-use auth tokens this one is
// a standing capability the owner can see and revoke), unique-indexed for the
// lookup, and dies the moment the owner disables sharing.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateToken } from "@/lib/tokens";

/** (Re)enable sharing: always mints a FRESH token, so re-enabling after a
 *  disable never resurrects a link that was already circulating. */
export async function enableListShare(listId: string): Promise<string> {
  const token = generateToken();
  await prisma.savedList.update({
    where: { id: listId },
    data: { shareToken: token, shareCreatedAt: new Date() },
  });
  return token;
}

export async function disableListShare(listId: string): Promise<void> {
  await prisma.savedList.updateMany({
    where: { id: listId },
    data: { shareToken: null, shareCreatedAt: null },
  });
}

/** Everything the public share page renders — and NOTHING else. An explicit
 *  `select` at every level, never a bare `include`: an `include` returns all
 *  scalars, which on this UNAUTHENTICATED page would pull the list's internal
 *  `note`/`budget`, the raw net `basePrice`, and `Title.commercialExtra`
 *  (desk-only negotiation notes) into the query — kept off the wire today only
 *  because the page has no client component, i.e. one refactor from a leak.
 *  The select makes the exclusion a property of the data, not of the render. */
export const SHARED_LIST_SELECT = {
  id: true,
  name: true,
  organizationId: true,
  archivedAt: true,
  clientApprovedAt: true,
  waveNumber: true,
  articleAngle: true,
  items: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      productId: true,
      quantity: true,
      withContent: true,
      scheduleStart: true,
      product: {
        select: {
          type: true,
          basePrice: true,
          currency: true,
          active: true,
          confirmedAt: true,
          priceRules: true,
          title: {
            select: {
              name: true,
              websiteUrl: true,
              aliases: true,
              pricesPublic: true,
              publisher: { select: { name: true, pricesPublic: true } },
            },
          },
        },
      },
      title: { select: { name: true, websiteUrl: true, aliases: true } },
    },
  },
  programme: { select: { name: true, plannedWaves: true } },
  organization: { select: { name: true } },
} satisfies Prisma.SavedListSelect;

/** The list behind a share token — null for unknown tokens and for lists
 *  archived after sharing (archiving is an implicit revoke). */
export async function loadSharedList(token: string) {
  if (!token || token.length < 20) return null; // never match on junk/empty
  const list = await prisma.savedList.findUnique({
    where: { shareToken: token },
    select: SHARED_LIST_SELECT,
  });
  if (!list || list.archivedAt) return null;
  return list;
}

export type SharedList = NonNullable<Awaited<ReturnType<typeof loadSharedList>>>;

export function shareUrl(appUrl: string, locale: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/${locale}/share/${token}`;
}

/** Stamp a view (fire-and-forget from the public page). updateMany so a
 *  concurrently revoked token no-ops instead of throwing. */
export async function recordShareView(token: string): Promise<void> {
  await prisma.savedList.updateMany({
    where: { shareToken: token },
    data: { shareViewedAt: new Date(), shareViewCount: { increment: 1 } },
  });
}

/** The client's approval click. Idempotent: the first click wins, later
 *  clicks (or a double-post) never re-stamp or re-notify. Returns the list
 *  when THIS call performed the approval, null otherwise. */
export async function approveSharedList(token: string) {
  if (!token || token.length < 20) return null;
  const list = await prisma.savedList.findUnique({
    where: { shareToken: token },
    select: { id: true, name: true, organizationId: true, archivedAt: true, clientApprovedAt: true },
  });
  if (!list || list.archivedAt || list.clientApprovedAt) return null;
  // Guarded update: two concurrent first-clicks race on clientApprovedAt null.
  const res = await prisma.savedList.updateMany({
    where: { id: list.id, clientApprovedAt: null },
    data: { clientApprovedAt: new Date() },
  });
  return res.count === 1 ? list : null;
}
