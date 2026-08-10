// Pure helper for the catalog "add to list" popover: collapse SavedListItem
// rows (title placeholders AND concrete product lines) into a titleId ->
// listId[] membership map, so the UI can tick every list a title already
// belongs to regardless of how it was added.

export type SavedListMembershipRow = {
  listId: string;
  titleId: string | null;
  product: { titleId: string } | null;
};

export function savedListMembershipMap(
  rows: Array<SavedListMembershipRow>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const titleId = row.titleId ?? row.product?.titleId;
    if (!titleId) continue;
    const listIds = map.get(titleId);
    if (!listIds) {
      map.set(titleId, [row.listId]);
    } else if (!listIds.includes(row.listId)) {
      listIds.push(row.listId);
    }
  }
  return map;
}
