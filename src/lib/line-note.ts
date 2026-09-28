// Customer-visible per-line note ("Merknad") shared by list lines
// (SavedListItem.notes -> PlanItem.notes) and quote lines
// (QuoteLine.customerNote). Plain text only: rendered as a text node on the
// web and as a PDF/DOCX text run, never as HTML.

export const LINE_NOTE_MAX = 500;

export type LineNoteResult =
  | { ok: true; note: string | null }
  | { ok: false; reason: "too-long" };

/** Trim, normalise line endings and collapse runs of blank lines. An empty
 *  result clears the note (null); anything over LINE_NOTE_MAX is rejected
 *  rather than silently truncated, so the author sees what was lost. */
export function normalizeLineNote(raw: unknown): LineNoteResult {
  if (typeof raw !== "string") return { ok: true, note: null };
  const note = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (note.length === 0) return { ok: true, note: null };
  if (note.length > LINE_NOTE_MAX) return { ok: false, reason: "too-long" };
  return { ok: true, note };
}

/** The buyer's line note travels from each plan line onto the quote line
 *  for the same placement. If a product repeats, the first non-empty note
 *  wins, so the quote never silently merges two notes. */
export function noteByProductId(
  items: ReadonlyArray<{ productId: string | null; notes: string | null }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of items) {
    if (item.productId && item.notes && !out.has(item.productId)) {
      out.set(item.productId, item.notes);
    }
  }
  return out;
}
