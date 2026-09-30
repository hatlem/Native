// The identity of a saved list's committed rows, shared by the firm-order
// submit guard (lib/commerce/firm-order.ts) and the client-approval version
// (lib/plan-version.ts). Pure and DB-free so both unit-test without a database.

export type FingerprintRow = {
  id: string;
  quantity: number;
  productId: string | null;
  titleId: string | null;
  withContent: boolean;
};

/** One row's commercial identity: line, qty, product/title, withContent. */
export function fingerprintRow(r: FingerprintRow): string {
  return `${r.id}:${r.quantity}:${r.productId ?? ""}:${r.titleId ?? ""}:${r.withContent ? 1 : 0}`;
}

/** Order-insensitive identity of a saved list's rows — the exact fields whose
 *  concurrent change must invalidate a submit (line set, qty, product/title,
 *  withContent → CONTENT_FEE). Shared by /plan submit and the in-txn guard. */
export function fingerprintListItems(rows: readonly FingerprintRow[]): string {
  return rows.map(fingerprintRow).sort().join("|");
}
