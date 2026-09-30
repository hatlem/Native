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
