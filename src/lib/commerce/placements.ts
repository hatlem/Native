// What counts as a placement on a quote, order or invoice. A CONTENT_FEE line
// bills our article production FOR a placement; it is not a placement itself.
// Counting every line said "4 editorial-grade native placements" for 2
// placements plus their 2 article fees, and "Lines 4" on the order
// (BUG-final-local-5). Every count a buyer or the desk reads goes through
// here. Pure, so the rule unit-tests without a database.

type LineWithKind = { kind?: "INVENTORY" | "CONTENT_FEE" | null };

/** A placement line: the publisher inventory the buyer booked. Lines without
 *  a kind predate content fees and are placements. */
export function isPlacementLine(line: LineWithKind): boolean {
  return (line.kind ?? "INVENTORY") === "INVENTORY";
}

/** How many placements a set of quote/order lines holds (fee lines excluded). */
export function placementCount(lines: readonly LineWithKind[]): number {
  return lines.filter(isPlacementLine).length;
}

/** The Prisma filter for the same rule, for `_count` selects. */
export const PLACEMENT_LINE_WHERE = { kind: "INVENTORY" } as const;

// ---------- Which placement a content fee belongs to ----------
//
// A CONTENT_FEE line has no product of its own. Its description names the
// placement it writes for: "Content production — <placement description>"
// (money.ts computeContentFeeLines), where the placement's description is the
// product name it was priced under. That convention is the only link between
// the two lines, so it is written and read through here alone.

export const CONTENT_FEE_PREFIX = "Content production — ";

/** The description of the fee line that bills the article for a placement. */
export function contentFeeDescription(placementDescription: string): string {
  return `${CONTENT_FEE_PREFIX}${placementDescription}`;
}

/** The placement description a fee line names, or null for any other line. */
export function feePlacementDescription(description: string): string | null {
  return description.startsWith(CONTENT_FEE_PREFIX) ? description.slice(CONTENT_FEE_PREFIX.length) : null;
}

type DescribedLine = LineWithKind & { description: string };

/** The placement line among `lines` (the same quote's) that a content-fee
 *  line bills the article for; undefined for a placement line, or when the
 *  fee's description names no placement on the quote. */
export function feePlacementLine<T extends DescribedLine>(fee: DescribedLine, lines: readonly T[]): T | undefined {
  if (isPlacementLine(fee)) return undefined;
  const name = feePlacementDescription(fee.description);
  if (name === null) return undefined;
  return lines.find((l) => isPlacementLine(l) && l.description === name);
}

type PositionedLine = LineWithKind & { position: number };

/** For an order's content-fee lines, the placement quote line each bills the
 *  article for, keyed by order-line id. Order lines carry no description:
 *  each is paired with the quote line it was copied from, which has the same
 *  position (accept-quote.ts, firm-order.ts). A position two quote lines
 *  share (rows written before positions existed) pairs with nothing, so a
 *  fee is never labelled with another placement's name. */
export function orderFeePlacements<Q extends DescribedLine & PositionedLine>(
  orderLines: readonly (PositionedLine & { id: string })[],
  quoteLines: readonly Q[],
): Map<string, Q> {
  const byPosition = new Map<number, Q[]>();
  for (const q of quoteLines) byPosition.set(q.position, [...(byPosition.get(q.position) ?? []), q]);
  const out = new Map<string, Q>();
  for (const line of orderLines) {
    if (isPlacementLine(line)) continue;
    const source = byPosition.get(line.position);
    if (source?.length !== 1 || isPlacementLine(source[0])) continue;
    const placement = feePlacementLine(source[0], quoteLines);
    if (placement) out.set(line.id, placement);
  }
  return out;
}
