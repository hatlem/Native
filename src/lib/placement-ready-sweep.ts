// Placement-ready sweep — finds SavedListItem placeholders (titleId set,
// productId null) whose Title has since gained a confirmed, bookable
// Product, and nudges the buyer's org + the desk to resolve it via
// "Bruk plassering". Never sets productId itself — that stays a human
// decision (resolveTitleLine, src/app/list-actions.ts), preserving the
// desk-RFQ gate an unresolved placeholder always forces.
//
// Idempotency reuses AuditLog as a per-item marker — the same trick
// metrics-sweep.ts uses for its once-per-day latch, keyed per item
// instead of per day, so a given placeholder is ever notified once.

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyOrg, notifyDesk } from "@/lib/notify";

const NOTIFIED_ACTION = "placement-ready.notified";
const entityFor = (itemId: string) => `SavedListItem:${itemId}`;

export type PlacementReadySweepResult = { notified: number };

export async function runPlacementReadySweep(): Promise<PlacementReadySweepResult> {
  const placeholders = await prisma.savedListItem.findMany({
    where: { productId: null, titleId: { not: null } },
    select: {
      id: true,
      titleId: true,
      list: {
        select: {
          id: true,
          name: true,
          organizationId: true,
          organization: { select: { marketCode: true } },
        },
      },
      title: { select: { name: true } },
    },
  });
  if (placeholders.length === 0) return { notified: 0 };

  const markets = await prisma.market.findMany({ select: { code: true, defaultLocale: true } });
  const localeByMarket = new Map(markets.map((m) => [m.code, m.defaultLocale]));

  let notified = 0;
  for (const item of placeholders) {
    const entity = entityFor(item.id);
    const already = await prisma.auditLog.findFirst({
      where: { entity, action: NOTIFIED_ACTION },
      select: { id: true },
    });
    if (already) continue;

    const product = await prisma.product.findFirst({
      where: { titleId: item.titleId!, active: true, bookable: true, confirmedAt: { not: null } },
      select: { id: true },
    });
    if (!product) continue;

    const buyerLocale = item.list.organization.marketCode
      ? (localeByMarket.get(item.list.organization.marketCode) ?? "no")
      : "no";
    const titleName = item.title!.name;
    const notifTitle = `${titleName} har nå en pris`;
    const body = `En plassering er nå tilgjengelig for ${titleName} i listen «${item.list.name}». Åpne planen og velg den under "Bruk plassering".`;

    await Promise.all([
      notifyOrg(item.list.organizationId, {
        kind: "TITLE_PRODUCT_READY",
        title: notifTitle,
        body,
        link: `/${buyerLocale}/plan?list=${item.list.id}`,
      }),
      notifyDesk({
        kind: "TITLE_PRODUCT_READY",
        title: notifTitle,
        body,
        link: `/no/plan?list=${item.list.id}`,
      }),
    ]);
    await recordAudit(null, NOTIFIED_ACTION, entity, { productId: product.id });
    notified++;
  }
  return { notified };
}
