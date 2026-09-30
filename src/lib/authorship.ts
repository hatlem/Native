// Content authorship — *who writes the article* for a placement. This is a
// distinct axis from LineKind (INVENTORY vs CONTENT_FEE), which is a billing
// concern. Authorship is the canonical per-line fact, carried Plan→Order so a
// confirmed order can always answer "who is writing this?" instead of leaving
// "buyer brought their own copy" and "publisher produces it" as byte-identical
// rows.
//
// `withContent` (the buyer's per-line "We write it") is the input: on is
// NATIVESPIN_PRODUCED; off is BUYER_SUPPLIED, or PUBLISHER_PRODUCED on a
// placement the publisher's studio can write (placementContentIntent below).
//
// The string-literal values mirror the Prisma `AuthorshipMode` enum exactly, so
// this type is interchangeable with the generated one (same pattern as
// LineKind's "INVENTORY" | "CONTENT_FEE") and the helpers stay DB-free/testable.
export type AuthorshipMode =
  | "BUYER_SUPPLIED"
  | "NATIVESPIN_PRODUCED"
  | "PUBLISHER_PRODUCED";

// The historical meaning of withContent=false: the buyer supplies their own
// article. The safe fallback whenever intent is unknown.
export const DEFAULT_AUTHORSHIP_MODE: AuthorshipMode = "BUYER_SUPPLIED";

// Compat shim — derive the mode from the buyer's v1 toggle. true ⇒ NativeSpin
// writes it; false/absent ⇒ bring-your-own.
export function authorshipFromWithContent(
  withContent: boolean | undefined | null,
): AuthorshipMode {
  return withContent ? "NATIVESPIN_PRODUCED" : "BUYER_SUPPLIED";
}

// The persisted pair behind the buyer's "We write it" toggle. SavedListItem
// stores both columns (withContent drives the UI, authorshipMode drives the
// RFQ snapshot, the content-fee lines and writer staffing), so every write path
// — toggle, add, copy to a new list/wave, merge — builds the pair here and
// nowhere else. A DB CHECK (SavedListItem_authorship_matches_content) backstops
// it: withContent ⇔ NATIVESPIN_PRODUCED.
//
// `carried` is the mode the row (or its copy source) already holds. Turning
// the toggle on always means NativeSpin writes it. Off keeps a carried
// non-NativeSpin mode — a copy (new list, next wave, reorder) keeps the
// buyer's "Let the publisher write it" — and never a stale NATIVESPIN_PRODUCED.
export type ContentIntent = { withContent: boolean; authorshipMode: AuthorshipMode };

export function contentIntent(
  withContent: boolean,
  carried?: AuthorshipMode | null,
): ContentIntent {
  if (withContent) return { withContent: true, authorshipMode: "NATIVESPIN_PRODUCED" };
  const authorshipMode =
    carried && carried !== "NATIVESPIN_PRODUCED" ? carried : DEFAULT_AUTHORSHIP_MODE;
  return { withContent: false, authorshipMode };
}

// ---------------------------------------------------------------------------
// Who writes a line is the BUYER's choice, and every line starts with us
// writing it: added from the catalog, the title page, compare, the
// recommenders, a heart, a list checklist or as a title placeholder. The
// catalog's price band is all-in — it includes our article fee
// (display-price.ts customerPrice) — so the plan then shows the price the
// buyer saw, and we earn on every placement unless the buyer opts out on /plan.
//
// What "opting out" means depends on the placement:
//   - most placements: the buyer brings their own copy (BUYER_SUPPLIED);
//   - a placement the publisher's own studio can write
//     (Product.inclusions.production = "PUBLISHER", or an explicit production
//     fee of 0 on the offer/publication — schema: "0 = publisher includes
//     production"): "Let the publisher write it" (PUBLISHER_PRODUCED). The
//     buyer is never asked for copy there, and no fee of ours is charged.
// The fee itself always follows the line's authorship, never the product
// (pricing/production-fee.ts): NATIVESPIN_PRODUCED bills our fee even where
// the publisher could have written it.
// ---------------------------------------------------------------------------

export type ContentDefaultSource = {
  inclusions?: unknown;
  productionFee?: unknown;
  title?: { productionFeeDefault?: unknown } | null;
};

function isExplicitZero(v: unknown): boolean {
  return v != null && Number(v) === 0;
}

// Whether the publisher's studio offers to write this placement's article —
// i.e. whether /plan offers "Let the publisher write it" as the alternative
// to "We write it".
export function publisherCanWrite(product: ContentDefaultSource): boolean {
  const inclusions = product.inclusions as { production?: unknown } | null | undefined;
  if (inclusions?.production === "PUBLISHER") return true;
  // First set fee wins, as in resolveProductionFee: an offer-level fee (even a
  // non-zero one) overrides the publication default.
  if (product.productionFee != null) return isExplicitZero(product.productionFee);
  return isExplicitZero(product.title?.productionFeeDefault);
}

// A new line, from any add path: we write it.
export function defaultContentIntent(): ContentIntent {
  return contentIntent(true);
}

// THE rule for a placement's authorship from the buyer's choice: on ⇒
// NativeSpin writes it; off ⇒ the publisher where their studio can write it,
// else the buyer's own copy. The /plan toggle, a placeholder resolved onto a
// product, an explicit add and the instant order all go through it, so a line
// is never PUBLISHER_PRODUCED on a placement the publisher doesn't write, nor
// BUYER_SUPPLIED where the choice offered was the publisher. The fee is
// charged iff the result is NATIVESPIN_PRODUCED (withContent), which is also
// what the list fingerprint and the DB CHECK bind to.
export function placementContentIntent(
  withContent: boolean,
  product: ContentDefaultSource | null | undefined,
): ContentIntent {
  if (withContent) return contentIntent(true);
  return {
    withContent: false,
    authorshipMode: product && publisherCanWrite(product) ? "PUBLISHER_PRODUCED" : DEFAULT_AUTHORSHIP_MODE,
  };
}

// Two lines folding into one (same product added twice, a placeholder resolved
// onto an existing line, a catalog merge): if either asked us to write it, the
// survivor does — dropping a content request silently loses a paid service the
// buyer chose. Otherwise the survivor keeps its own mode.
export function mergeContentIntent(
  survivor: ContentIntent,
  absorbed: Pick<ContentIntent, "withContent">,
): ContentIntent {
  return contentIntent(survivor.withContent || absorbed.withContent, survivor.authorshipMode);
}

// Reverse shim for code still reading the boolean until the UI exposes a full
// mode selector. Only NativeSpin-produced is a content-fee placement.
export function withContentFromAuthorship(mode: AuthorshipMode): boolean {
  return mode === "NATIVESPIN_PRODUCED";
}

// NativeSpin produces the article ⇒ we bill a CONTENT_FEE and staff a writer.
export function nativeSpinProduces(mode: AuthorshipMode): boolean {
  return mode === "NATIVESPIN_PRODUCED";
}

// A writer may only be staffed on lines NativeSpin produces. Buyer- and
// publisher-produced placements are written elsewhere; assigning one of our
// writers to them is a category error, not a workflow.
export function writerAssignableForMode(mode: AuthorshipMode): boolean {
  return mode === "NATIVESPIN_PRODUCED";
}

// Whether a writer may be staffed on a specific order line. Authorship alone
// isn't enough: a CONTENT_FEE line is a *billing* line (it carries
// NATIVESPIN_PRODUCED because the fee is for our production) but it is not the
// placement — the article is briefed and written against the INVENTORY line.
// So staffing requires BOTH the placement axis (kind) and the authorship axis.
export function writerStaffableLine(line: {
  kind: "INVENTORY" | "CONTENT_FEE";
  authorshipMode: AuthorshipMode;
}): boolean {
  return line.kind === "INVENTORY" && writerAssignableForMode(line.authorshipMode);
}

// Resolve the authorship a newly-created order line should carry. INVENTORY
// (placement) lines inherit the buyer's per-product intent; CONTENT_FEE lines
// exist only because NativeSpin produces, so they are always NATIVESPIN_PRODUCED
// (and carry no productId to look up). An INVENTORY line whose product isn't in
// the map falls back to the safe default.
export function authorshipForOrderLine(
  line: { kind: "INVENTORY" | "CONTENT_FEE"; productId: string | null },
  authorshipByProduct: Map<string, AuthorshipMode>,
): AuthorshipMode {
  if (line.kind === "CONTENT_FEE") return "NATIVESPIN_PRODUCED";
  if (line.productId) {
    const mode = authorshipByProduct.get(line.productId);
    if (mode) return mode;
  }
  return DEFAULT_AUTHORSHIP_MODE;
}
