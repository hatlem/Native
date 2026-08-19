import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { DataLayerEvent } from "@/app/data-layer-event";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/app/status-badge";
import { Breadcrumb, DetailHead, MetaRow } from "@/components";
import { PlanItemsSection } from "./_components/PlanItemsSection";
import { PendingQuoteSection } from "./_components/PendingQuoteSection";
import { QuoteSection } from "./_components/QuoteSection";
import { OrderSection } from "./_components/OrderSection";

export const dynamic = "force-dynamic";

export default async function RequestPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "requests" });

  const request = await prisma.request.findUnique({
    where: { id },
    include: {
      organization: true,
      plan: { include: { items: true } },
      quotes: {
        orderBy: { createdAt: "desc" },
        include: {
          lines: true,
          order: {
            include: {
              invoices: true,
              lines: {
                include: {
                  articlePlacement: {
                    include: {
                      article: {
                        include: {
                          versions: { orderBy: { version: "desc" }, take: 1 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!request) notFound();

  const session = await auth();
  const role = session?.user?.role;
  const isDesk = role === "DESK" || role === "SUPERADMIN";
  if (!isDesk) {
    const ws = await getWorkspace(session?.user?.id);
    if (!ws?.scopeOrgIds.includes(request.organizationId)) {
      notFound();
    }
  }

  // Plan items split into product lines and Title placeholders (productId
  // null). Fetch products for the former and bare title names for the
  // latter so PlanItemsSection can render placeholders without crashing.
  const productIds = request.plan.items
    .map((i) => i.productId)
    .filter((id): id is string => !!id);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { title: { include: { market: true } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const titleIds = request.plan.items
    .map((i) => i.titleId)
    .filter((id): id is string => !!id);
  const titles = titleIds.length
    ? await prisma.title.findMany({
        where: { id: { in: titleIds } },
        select: { id: true, name: true },
      })
    : [];
  const titleById = new Map(titles.map((t) => [t.id, { name: t.name }]));

  // Resolve the assigned desk buyer's name so the buyer-facing page can
  // surface accountability ("Hentet av Astrid"). Schema has the FK column
  // but no relation — fetch by ID.
  const assignedBuyer = request.assignedDeskUserId
    ? await prisma.user.findUnique({
        where: { id: request.assignedDeskUserId },
        select: { name: true, email: true },
      })
    : null;

  // Marketing promise: a firm quote in ≤24 working hours. Surface the
  // derived target so the buyer can see what they're waiting on instead
  // of staring at a generic ⏳. Naive working-hour math is fine here —
  // weekends roll forward by 48 / 72 hours.
  const slaTarget = (() => {
    const t = new Date(request.createdAt);
    let hoursAdded = 0;
    while (hoursAdded < 24) {
      t.setHours(t.getHours() + 1);
      const day = t.getDay(); // 0 = Sun, 6 = Sat
      if (day !== 0 && day !== 6) hoursAdded += 1;
    }
    return t;
  })();

  // Multi-currency requests carry one Quote per placement market.
  // Sort by currency so the buyer reads them in a stable order across
  // page loads (alphabetical by ISO code).
  const quotes = [...request.quotes].sort((a, b) =>
    a.currency.localeCompare(b.currency),
  );
  const orders = quotes.flatMap((q) => (q.order ? [q.order] : []));
  const allAccepted = quotes.length > 0 && orders.length === quotes.length;
  const orderInvoice = orders[0]?.invoices[0];

  // Aggregate item count across quotes for the campaign-banner outcome
  // line ("3 editorial-grade native placements" rather than per-quote).
  const totalQuoteLines = quotes.reduce((s, q) => s + q.lines.length, 0);

  return (
    <>
      <Breadcrumb href="/requests">{t("listTitle")}</Breadcrumb>

      <DataLayerEvent event="rfq_submitted" id={request.id} />
      {orders.map((o) => {
        const q = quotes.find((x) => x.order?.id === o.id)!;
        return (
          <DataLayerEvent
            key={o.id}
            event="order_confirmed"
            id={o.id}
            value={Number(q.total)}
            currency={q.currency}
          />
        );
      })}

      <DetailHead
        eyebrow={t("eyebrow")}
        title={`${t("title")} · ${request.organization.name}`}
        lead={request.plan.name}
        meta={
          <>
            <MetaRow label={t("status")}>
              <StatusBadge value={request.status} />
            </MetaRow>
            <MetaRow label={t("items")}>{request.plan.items.length}</MetaRow>
            {quotes.length > 0 ? (
              <MetaRow label={t("total")}>
                {quotes
                  .map((q) =>
                    formatMoney(Number(q.total), q.currency, locale),
                  )
                  .join(" · ")}
              </MetaRow>
            ) : null}
          </>
        }
      />

      <PlanItemsSection
        locale={locale}
        items={request.plan.items}
        byId={byId}
        titleById={titleById}
      />

      {quotes.length === 0 ? (
        <PendingQuoteSection
          locale={locale}
          assignedBuyer={assignedBuyer}
          slaTarget={slaTarget}
          briefSummary={request.briefSummary}
        />
      ) : (
        <QuoteSection
          locale={locale}
          quotes={quotes}
          products={products}
          byId={byId}
          organizationName={request.organization.name}
          requestId={request.id}
          totalQuoteLines={totalQuoteLines}
          allAccepted={allAccepted}
          orders={orders}
        />
      )}

      {orders.length > 0 ? (
        <OrderSection
          locale={locale}
          orders={orders}
          byId={byId}
          orderInvoice={orderInvoice}
        />
      ) : null}
    </>
  );
}
