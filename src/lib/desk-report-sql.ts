// The desk report's numbers, aggregated in the database.
//
// The page used to load every order with its quote lines, every order line
// and every invoice, then add them up in JavaScript on each view. These
// queries return a handful of rows whatever the volume. The revenue rules are
// the ones lib/reporting.ts pins with tests (deskRevenueByCurrency): cancelled
// orders out, credit notes off, extra work in, price-on-request lines ignored
// — desk-report-sql.it.test.ts proves both give the same answer.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { averageOrderValue, type CurrencyRevenue, type Tally } from "@/lib/reporting";
import type { ReportPeriod } from "@/lib/report-period";

// `AND <column> >= from AND <column> < to`, or nothing when unbounded.
function windowSql(column: Prisma.Sql, p: ReportPeriod): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (p.from) parts.push(Prisma.sql`AND ${column} >= ${p.from}`);
  if (p.to) parts.push(Prisma.sql`AND ${column} < ${p.to}`);
  return parts.length ? Prisma.join(parts, " ") : Prisma.empty;
}

type RevenueRow = {
  currency: string;
  count: bigint;
  gmv: Prisma.Decimal | null;
  margin: Prisma.Decimal | null;
  fee: Prisma.Decimal | null;
};

// Orders are placed in the window by their creation date (the acceptance of
// the quote). `orderIds` narrows to specific orders — used by the test.
export async function deskRevenueByCurrencySql(
  period: ReportPeriod,
  opts: { orderIds?: string[] } = {},
): Promise<CurrencyRevenue[]> {
  if (opts.orderIds && opts.orderIds.length === 0) return [];
  const onlyIds = opts.orderIds ? Prisma.sql`AND o."id" IN (${Prisma.join(opts.orderIds)})` : Prisma.empty;
  const rows = await prisma.$queryRaw<RevenueRow[]>(Prisma.sql`
    WITH live AS (
      SELECT o."id" AS order_id, q."id" AS quote_id, q."currency" AS currency,
             q."total" AS quote_total, q."vatPct" AS vat_pct
        FROM "Order" o
        JOIN "Quote" q ON q."id" = o."quoteId"
       WHERE o."status" <> 'CANCELLED'
         ${windowSql(Prisma.sql`o."createdAt"`, period)}
         ${onlyIds}
    ),
    extra AS (
      SELECT e."orderId" AS order_id, SUM(e."lineTotal") AS net
        FROM "OrderExtraWork" e
       WHERE e."orderId" IN (SELECT order_id FROM live)
       GROUP BY e."orderId"
    ),
    credit AS (
      SELECT c."orderId" AS order_id, SUM(c."amount") AS amount
        FROM "CreditNote" c
       WHERE c."orderId" IN (SELECT order_id FROM live)
       GROUP BY c."orderId"
    ),
    line AS (
      SELECT l."quoteId" AS quote_id,
             SUM(CASE WHEN l."kind" IN ('CONTENT_FEE', 'EXTRA_WORK') THEN l."lineTotal" ELSE 0 END) AS fee,
             SUM(CASE WHEN l."kind" IN ('CONTENT_FEE', 'EXTRA_WORK') THEN 0
                      ELSE l."lineTotal" - l."unitCost" * l."quantity" END) AS margin
        FROM "QuoteLine" l
       WHERE l."priceOnRequest" = false
         AND l."quoteId" IN (SELECT quote_id FROM live)
       GROUP BY l."quoteId"
    )
    SELECT live.currency AS currency,
           COUNT(*) AS count,
           SUM(live.quote_total
               + COALESCE(extra.net, 0) * (1 + live.vat_pct / 100)
               - COALESCE(credit.amount, 0)) AS gmv,
           SUM(COALESCE(line.margin, 0)) AS margin,
           SUM(COALESCE(line.fee, 0) + COALESCE(extra.net, 0)) AS fee
      FROM live
      LEFT JOIN extra ON extra.order_id = live.order_id
      LEFT JOIN credit ON credit.order_id = live.order_id
      LEFT JOIN line ON line.quote_id = live.quote_id
     GROUP BY live.currency
     ORDER BY live.currency ASC`);

  return rows.map((r) => {
    const count = Number(r.count);
    const gmv = Math.round(Number(r.gmv ?? 0));
    const margin = Number(r.margin ?? 0);
    const fee = Number(r.fee ?? 0);
    const total = margin + fee;
    return {
      currency: r.currency,
      count,
      gmv,
      aov: averageOrderValue(gmv, count),
      split: {
        marginRevenue: Math.round(margin),
        contentFeeRevenue: Math.round(fee),
        totalRevenue: Math.round(total),
        contentFeeRatioPct: total > 0 ? Math.round((fee / total) * 1000) / 10 : 0,
      },
    };
  });
}

function toTally(rows: { key: string; count: bigint }[]): Tally[] {
  return rows
    .map((r) => ({ key: r.key, count: Number(r.count) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

// Every order in the window by status (cancelled ones included — this is the
// pipeline view, not the revenue view).
export async function orderStatusTally(period: ReportPeriod): Promise<Tally[]> {
  const rows = await prisma.$queryRaw<{ key: string; count: bigint }[]>(Prisma.sql`
    SELECT o."status"::text AS key, COUNT(*) AS count
      FROM "Order" o
     WHERE true ${windowSql(Prisma.sql`o."createdAt"`, period)}
     GROUP BY o."status"`);
  return toTally(rows);
}

// Placements by title category, for orders that were not cancelled.
export async function orderCategoryTally(period: ReportPeriod): Promise<Tally[]> {
  const rows = await prisma.$queryRaw<{ key: string; count: bigint }[]>(Prisma.sql`
    SELECT t."category" AS key, COUNT(*) AS count
      FROM "OrderLine" ol
      JOIN "Order" o ON o."id" = ol."orderId"
      JOIN "Product" p ON p."id" = ol."productId"
      JOIN "Title" t ON t."id" = p."titleId"
     WHERE o."status" <> 'CANCELLED'
       ${windowSql(Prisma.sql`o."createdAt"`, period)}
     GROUP BY t."category"`);
  return toTally(rows);
}

export async function invoiceStatusTally(period: ReportPeriod): Promise<Tally[]> {
  const rows = await prisma.$queryRaw<{ key: string; count: bigint }[]>(Prisma.sql`
    SELECT i."status"::text AS key, COUNT(*) AS count
      FROM "Invoice" i
     WHERE true ${windowSql(Prisma.sql`i."createdAt"`, period)}
     GROUP BY i."status"`);
  return toTally(rows);
}
