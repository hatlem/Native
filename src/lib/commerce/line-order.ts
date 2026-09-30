// One ordering rule for quote, order and invoice lines, shared by every
// reader (desk quote editor, buyer quote, order pages, DOCX/PDF, invoice,
// exports). Lines carry the position they were generated at; `id` breaks
// ties for rows written before `position` existed or created in one batch.
//
// Without it Postgres returns rows in physical order, and an UPDATE moves a
// row to the end — a repriced quote line used to jump to the bottom.

/** Prisma `orderBy` for QuoteLine / OrderLine / InvoiceLine. A function (not
 *  a shared const) so every call site gets a fresh, mutable array — Prisma's
 *  generated orderBy types don't accept readonly tuples. */
export function lineOrder(): [{ position: "asc" }, { id: "asc" }] {
  return [{ position: "asc" }, { id: "asc" }];
}

/** In-memory counterpart of lineOrder() for lines already loaded. */
export function compareLines(
  a: { position: number; id: string },
  b: { position: number; id: string },
): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
