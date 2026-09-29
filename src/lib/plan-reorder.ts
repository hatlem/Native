// Reordering lines on a plan. A plan shows two sections (the plan itself and
// its recommended alternatives) that share one SavedListItem.sortOrder
// sequence. Reordering one section keeps every item of the other section in
// its slot and renumbers the whole list 0..n-1, which also repairs duplicate
// sortOrders left by concurrent adds (lib/lists.ts nextSortOrder has no lock).

export type OrderedItem = { id: string; sortOrder: number; createdAt: Date };

export class ReorderMismatchError extends Error {
  constructor() {
    super("reorder ids must be exactly the section's current items");
  }
}

/** The list's current display order: sortOrder, then createdAt (as loadList). */
export function displayOrder<T extends OrderedItem>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
}

/**
 * New sortOrder for every item on the list after `sectionIds` (a subset of the
 * list's items) is put in `orderedIds` order. Throws ReorderMismatchError
 * unless `orderedIds` is exactly `sectionIds` permuted, so a stale tab can't
 * drop or smuggle in a line.
 */
export function reorderSection(
  listItems: readonly OrderedItem[],
  sectionIds: readonly string[],
  orderedIds: readonly string[],
): { id: string; sortOrder: number }[] {
  const section = new Set(sectionIds);
  if (
    orderedIds.length !== section.size ||
    new Set(orderedIds).size !== orderedIds.length ||
    orderedIds.some((id) => !section.has(id))
  ) {
    throw new ReorderMismatchError();
  }
  const queue = [...orderedIds];
  return displayOrder(listItems).map((item, index) => ({
    id: section.has(item.id) ? queue.shift()! : item.id,
    sortOrder: index,
  }));
}

export type SortKey = "title" | "publisher" | "price";

export type SortableLine = { id: string; title: string; publisher: string; price: number | null };

/** One-click sort for a section; ties keep their current relative order. */
export function sortLines(lines: readonly SortableLine[], key: SortKey, locale: string): string[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const indexed = lines.map((line, index) => ({ line, index }));
  indexed.sort((a, b) => {
    let diff = 0;
    if (key === "title") diff = collator.compare(a.line.title, b.line.title);
    else if (key === "publisher")
      diff = collator.compare(a.line.publisher, b.line.publisher) || collator.compare(a.line.title, b.line.title);
    else {
      // Highest price first; lines without a visible price go last.
      const pa = a.line.price ?? -Infinity;
      const pb = b.line.price ?? -Infinity;
      diff = pb - pa;
    }
    return diff || a.index - b.index;
  });
  return indexed.map((x) => x.line.id);
}
