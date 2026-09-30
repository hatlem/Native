// Which version of a plan a client approval covers. Pure and DB-free (the
// share page, /plan's approval panel and the approve action all hash the same
// way, and the rule unit-tests without a database).

import { createHash } from "node:crypto";
import { fingerprintRow, type FingerprintRow } from "@/lib/commerce/list-fingerprint";

export type VersionedItem = FingerprintRow & {
  isAlternative: boolean;
  // What the share page shows per line beyond its commercial identity: the
  // run ("Oct – Nov 2026 · 2 months") and the customer-visible note.
  scheduleStart: Date | null;
  scheduleUnits: number | null;
  notes: string | null;
};

/** One committed line as the client sees it. Starts with the firm-order
 *  identity (line, qty, product/title, "We write it") and appends the run and
 *  the note only when the line has them, so a plan without dates or notes
 *  keeps the version it had before those were covered: approvals given since
 *  versioning shipped stay current unless they really missed something. The
 *  note is URI-encoded so its text can never mimic the ":" / "|" separators. */
export function versionRow(i: VersionedItem): string {
  let row = fingerprintRow(i);
  if (i.scheduleStart) {
    // Only a run with a start is shown; a unit count alone is invisible.
    row += `:s=${i.scheduleStart.toISOString().slice(0, 10)}~${i.scheduleUnits ?? ""}`;
  }
  const note = i.notes?.trim();
  if (note) row += `:n=${encodeURIComponent(note)}`;
  return row;
}

/** The version of a plan a client approves: a hash of its committed lines
 *  (alternatives excluded, order-insensitive) covering everything the share
 *  page shows about them: line set, quantity, product/title, "We write it",
 *  the run dates and length, and the customer note. Any change the client
 *  would have to see again changes it. */
export function planVersion(items: readonly VersionedItem[]): string {
  const rows = items
    .filter((i) => !i.isAlternative)
    .map(versionRow)
    .sort()
    .join("|");
  return createHash("sha256").update(rows).digest("hex");
}

export type ApprovalState =
  | { kind: "none" }
  // The client approved exactly the plan as it stands.
  | { kind: "current"; approvedAt: Date }
  // The client approved an earlier version; the lines changed since.
  | { kind: "stale"; approvedAt: Date };

/** An approval without a recorded version predates versioning: nothing says
 *  which lines it covered, so it counts as stale (never as a current
 *  approval of lines the client may not have seen). */
export function approvalState(
  list: { clientApprovedAt: Date | null; clientApprovedVersion: string | null },
  currentVersion: string,
): ApprovalState {
  if (!list.clientApprovedAt) return { kind: "none" };
  return list.clientApprovedVersion === currentVersion
    ? { kind: "current", approvedAt: list.clientApprovedAt }
    : { kind: "stale", approvedAt: list.clientApprovedAt };
}
