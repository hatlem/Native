// Content authorship — *who writes the article* for a placement. This is a
// distinct axis from LineKind (INVENTORY vs CONTENT_FEE), which is a billing
// concern. Authorship is the canonical per-line fact, carried Plan→Order so a
// confirmed order can always answer "who is writing this?" instead of leaving
// "buyer brought their own copy" and "publisher produces it" as byte-identical
// rows.
//
// `withContent` (the buyer's existing per-line toggle) is the v1 input and maps
// 1:1 onto the first two modes. PUBLISHER_PRODUCED has no buyer toggle yet, but
// is modelled now so the order record can represent it without a later schema
// split — the enum is far cheaper to collapse than a boolean is to grow.
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
