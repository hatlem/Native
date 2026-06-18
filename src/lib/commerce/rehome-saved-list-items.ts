import type { Prisma } from "@prisma/client";
import { clampQuantity } from "@/lib/basket";

/**
 * Re-point every SavedListItem from a soon-to-be-deleted product onto a
 * surviving product, BEFORE the dead product is hard-deleted.
 *
 * Why this exists: `SavedListItem.productId` is `ON DELETE CASCADE` (it must be —
 * the exactly-one-of(productId,titleId) CHECK makes SET NULL impossible). So a
 * product hard-delete (e.g. a future catalog dedup/merge script) would otherwise
 * DROP the buyer's saved line entirely instead of moving it to the survivor.
 * Catalog-merge tooling that hard-deletes a duplicate product should call this
 * inside its transaction first, the same way it re-homes priceQuote / contactLog
 * / etc. (Past one-off scripts predate the saved-lists feature; this is for the
 * next one — see the saved_lists_audit_remediation memory.)
 *
 * Handles the (listId, productId) unique: if the survivor is already a line on
 * the same list, the two lines merge (quantities summed, clamped) and the dead
 * line is removed; otherwise the dead line is simply re-pointed.
 */
export async function rehomeSavedListItems(
  tx: Prisma.TransactionClient,
  deadProductId: string,
  survivorProductId: string,
): Promise<{ moved: number; merged: number }> {
  if (deadProductId === survivorProductId) return { moved: 0, merged: 0 };
  const deadItems = await tx.savedListItem.findMany({
    where: { productId: deadProductId },
    select: { id: true, listId: true, quantity: true },
  });
  let moved = 0;
  let merged = 0;
  for (const item of deadItems) {
    const existing = await tx.savedListItem.findUnique({
      where: { listId_productId: { listId: item.listId, productId: survivorProductId } },
      select: { id: true, quantity: true },
    });
    if (existing && existing.id !== item.id) {
      await tx.savedListItem.update({
        where: { id: existing.id },
        data: { quantity: clampQuantity(existing.quantity + item.quantity) },
      });
      await tx.savedListItem.delete({ where: { id: item.id } });
      merged++;
    } else {
      await tx.savedListItem.update({
        where: { id: item.id },
        data: { productId: survivorProductId },
      });
      moved++;
    }
  }
  return { moved, merged };
}
