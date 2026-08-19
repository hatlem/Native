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

/** Everything the public share page renders. Deliberately EXCLUDES the
 *  list's internal note, org billing fields and anything desk-facing —
 *  the client sees what a proposal shows: lines, schedule, prices, totals. */
export const SHARED_LIST_INCLUDE = {
  items: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      product: {
        include: {
          title: { include: { publisher: { select: { name: true, pricesPublic: true } } } },
          priceRules: true,
        },
      },
      title: { select: { name: true, websiteUrl: true, aliases: true } },
    },
  },
  programme: { select: { name: true, plannedWaves: true } },
  organization: { select: { name: true } },
} satisfies Prisma.SavedListInclude;

/** The list behind a share token — null for unknown tokens and for lists
 *  archived after sharing (archiving is an implicit revoke). */
export async function loadSharedList(token: string) {
  if (!token || token.length < 20) return null; // never match on junk/empty
  const list = await prisma.savedList.findUnique({
    where: { shareToken: token },
    include: SHARED_LIST_INCLUDE,
  });
  if (!list || list.archivedAt) return null;
  return list;
}

export type SharedList = NonNullable<Awaited<ReturnType<typeof loadSharedList>>>;

export function shareUrl(appUrl: string, locale: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/${locale}/share/${token}`;
}
