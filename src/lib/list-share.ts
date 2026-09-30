// Client-share links for saved lists: an agency (or advertiser) shares a
// read-only view of a plan with their client for sign-off — no account, no
// sign-in, just an unguessable URL. The token is 256 bits (same generator as
// the auth tokens), stored plainly (unlike single-use auth tokens this one is
// a standing capability the owner can see and revoke), unique-indexed for the
// lookup, and dies the moment the owner disables sharing.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateToken } from "@/lib/tokens";
import { approvalState, planVersion } from "@/lib/plan-version";

// The approval version is pure (lib/plan-version.ts); re-exported so callers
// keep one import for everything share-related.
export { approvalState, planVersion, type ApprovalState } from "@/lib/plan-version";

/** (Re)enable sharing: always mints a FRESH token, so re-enabling after a
 *  disable never resurrects a link that was already circulating. A new link
 *  is a new review round: any earlier client approval is cleared. */
export async function enableListShare(listId: string): Promise<string> {
  const token = generateToken();
  await prisma.savedList.update({
    where: { id: listId },
    data: {
      shareToken: token,
      shareCreatedAt: new Date(),
      clientApprovedAt: null,
      clientApprovedVersion: null,
    },
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
  clientApprovedVersion: true,
  waveNumber: true,
  articleId: true,
  article: { select: { title: true } },
  items: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      productId: true,
      titleId: true,
      quantity: true,
      withContent: true,
      scheduleStart: true,
      // The run length the share page shows next to the start.
      scheduleUnits: true,
      // Customer-visible line note — the one per-line note the client sees.
      notes: true,
      // Recommended alternatives render in their own section, outside totals.
      isAlternative: true,
      product: {
        select: {
          type: true,
          // Turns scheduleUnits into weeks or months on the share page.
          bookingUnit: true,
          basePrice: true,
          currency: true,
          active: true,
          confirmedAt: true,
          // Exact figure vs band (lib/plan-total.ts lineDisplay): only an
          // instant-orderable FIRM line is shown exactly; a CPM/CPC line shows
          // its rate.
          visibility: true,
          pricingModel: true,
          // The article fee's offer/publication layers (production-fee.ts),
          // and whether the publisher writes the article (no fee of ours).
          productionFee: true,
          inclusions: true,
          // Only the rate-card fields the price engine reads (lib/plan-total.ts).
          priceRules: { select: { marginPct: true, seasonalMultiplier: true, minVolume: true } },
          title: {
            select: {
              name: true,
              websiteUrl: true,
              aliases: true,
              pricesPublic: true,
              productionFeeDefault: true,
              publisher: { select: { name: true, pricesPublic: true } },
              // The market drives the default margin, the content-fee rule
              // and VAT — the same inputs /plan prices with.
              market: { select: { code: true, vatRatePct: true } },
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

export type ApproveResult =
  | { outcome: "approved"; list: { id: string; name: string; organizationId: string } }
  // This version was already approved (double click, second tab): no-op.
  | { outcome: "already" }
  // The plan changed after the client loaded the page: nothing is approved;
  // they review the current version and approve that.
  | { outcome: "changed" }
  | { outcome: "not-found" };

/** The client's approval click, for the version of the plan the page showed
 *  (`seenVersion`). Approves only if that is still the plan's version, so a
 *  client can never approve lines they didn't see. Re-approving after the plan
 *  changed replaces the stale approval. Idempotent per version: a double-post
 *  never re-stamps or re-notifies. */
export async function approveSharedList(token: string, seenVersion: string): Promise<ApproveResult> {
  if (!token || token.length < 20) return { outcome: "not-found" };
  const list = await prisma.savedList.findUnique({
    where: { shareToken: token },
    select: {
      id: true,
      name: true,
      organizationId: true,
      archivedAt: true,
      clientApprovedAt: true,
      clientApprovedVersion: true,
      items: {
        select: {
          id: true,
          quantity: true,
          productId: true,
          titleId: true,
          withContent: true,
          isAlternative: true,
          scheduleStart: true,
          scheduleUnits: true,
          notes: true,
        },
      },
    },
  });
  if (!list || list.archivedAt) return { outcome: "not-found" };
  const current = planVersion(list.items);
  if (seenVersion !== current) return { outcome: "changed" };
  if (approvalState(list, current).kind === "current") return { outcome: "already" };
  // Guarded on the approval being read: two concurrent clicks race on it and
  // exactly one wins.
  const res = await prisma.savedList.updateMany({
    where: { id: list.id, clientApprovedVersion: list.clientApprovedVersion },
    data: { clientApprovedAt: new Date(), clientApprovedVersion: current },
  });
  if (res.count !== 1) return { outcome: "already" };
  return { outcome: "approved", list: { id: list.id, name: list.name, organizationId: list.organizationId } };
}
