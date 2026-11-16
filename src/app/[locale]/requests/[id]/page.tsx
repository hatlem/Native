import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { loadScope, canActOnOrg, canCommitOnOrg, canEditOnOrg } from "@/lib/scope";
import { DataLayerEvent } from "@/app/data-layer-event";
import { formatMoney, formatMoneyExact } from "@/lib/money";
import { paymentTermsDaysFor } from "@/lib/payment-terms";
import { StatusBadge } from "@/app/status-badge";
import { Breadcrumb, DetailHead, MetaRow } from "@/components";
import { PlanItemsSection } from "./_components/PlanItemsSection";
import { PendingQuoteSection } from "./_components/PendingQuoteSection";
import { QuoteSection } from "./_components/QuoteSection";
import {
  isQuoteExpired,
} from "@/lib/commerce/quote-validity";
import { placementCount } from "@/lib/commerce/placements";
import { reconcileExpiredQuotesInBackground } from "@/lib/commerce/quote-expiry";
import { OrderSection } from "./_components/OrderSection";
import { AcceptRefusedBanner } from "./_components/AcceptRefusedBanner";
import { BackOutNotice, BackOutSection } from "./_components/BackOutSection";
import { marketTimeZone } from "@/lib/markets";
import {
  loadDetailRequest,
  loadDetailProducts,
  loadDetailTitles,
  loadDetailAssignedBuyer,
  loadDetailRenewalRequest,
} from "@/lib/data/buyer/requests";

export const dynamic = "force-dynamic";

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "requests" });

  // The loader answers null for another organisation's request.
  const scope = await loadScope();
  const request = await loadDetailRequest(scope, { id });
  if (!request) notFound();

  if (!canActOnOrg(scope, request.organizationId)) notFound();
  // Whether THIS viewer may accept the quote (ordering rights in the request's
  // org). Without them the accept button is replaced by who can act.
  const canAccept = canCommitOnOrg(scope, request.organizationId);
  // A view-only seat sees the quote but can't ask the desk for anything.
  const canEdit = canEditOnOrg(scope, request.organizationId);

  // Plan items split into product lines and Title placeholders (productId
  // null). Fetch products for the former and bare title names for the
  // latter so PlanItemsSection can render placeholders without crashing.
  const productIds = request.plan.items
    .map((i) => i.productId)
    .filter((id): id is string => !!id);
  const products = await loadDetailProducts(scope, { productIds });
  const byId = new Map(products.map((p) => [p.id, p]));

  const titleIds = request.plan.items
    .map((i) => i.titleId)
    .filter((id): id is string => !!id);
  const titles = titleIds.length
    ? await loadDetailTitles(scope, { titleIds })
    : [];
  const titleById = new Map(titles.map((t) => [t.id, { name: t.name }]));

  // Resolve the assigned desk buyer's name so the buyer-facing page can
  // surface accountability ("Hentet av Astrid"). Schema has the FK column
  // but no relation — fetch by ID.
  const assignedBuyer = request.assignedDeskUserId
    ? await loadDetailAssignedBuyer(scope, { requestAssignedDeskUserId: request.assignedDeskUserId })
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
  // A quote replaced by a revision is history, not an offer: it leaves the
  // totals, the accept flow and the "all accepted" check, and is listed
  // separately with a pointer to the revision that replaced it.
  const quotes = request.quotes
    .filter((q) => q.status !== "SUPERSEDED")
    .sort((a, b) => a.currency.localeCompare(b.currency));
  const supersededQuotes = request.quotes
    .filter((q) => q.status === "SUPERSEDED")
    .sort((a, b) => a.currency.localeCompare(b.currency) || a.revision - b.revision);
  const orders = quotes.flatMap((q) => (q.order ? [q.order] : []));
  const allAccepted = quotes.length > 0 && orders.length === quotes.length;
  // Catch stored quote status up with the clock (bookkeeping), and show
  // "renewal requested" while the buyer's last ask is inside its cooldown.
  reconcileExpiredQuotesInBackground({ requestId: request.id });
  const renewalRequested = quotes.some((q) => !q.order && isQuoteExpired(q))
    ? !!(await loadDetailRenewalRequest(scope, { requestId: request.id }))
    : false;
  const orderInvoice = orders[0]?.invoices[0];

  // Aggregate placement count across quotes for the campaign-banner outcome
  // line ("3 editorial-grade native placements" rather than per-quote). The
  // article fees are billed with their placements, not counted as ones.
  const totalQuoteLines = quotes.reduce((s, q) => s + placementCount(q.lines), 0);

  return (
    <>
      <Breadcrumb href="/requests">{t("listTitle")}</Breadcrumb>

      <DataLayerEvent event="rfq_submitted" id={request.id} />
      {quotes
        .filter((q) => q.status === "ACCEPTED")
        .map((q) => (
          <DataLayerEvent
            key={`qa-${q.id}`}
            event="quote_accepted"
            id={q.id}
            value={Number(q.total)}
            currency={q.currency}
          />
        ))}
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
              {/* A request that became an order is CLOSED by design (an
                  instant order closes it at once); "Closed" next to a
                  confirmed order read like a cancellation, so the order's
                  own status stands in for it. */}
              <StatusBadge
                value={request.status === "CLOSED" && orders.length > 0 ? orders[0].status : request.status}
              />
            </MetaRow>
            <MetaRow label={t("items")}>{request.plan.items.length}</MetaRow>
            {quotes.length > 0 ? (
              <MetaRow label={t("total")}>
                {quotes
                  .map((q) =>
                    formatMoneyExact(Number(q.total), q.currency, locale),
                  )
                  .join(" · ")}
              </MetaRow>
            ) : null}
          </>
        }
      />

      <AcceptRefusedBanner locale={locale} sp={sp} />
      <BackOutNotice locale={locale} notice={typeof sp.notice === "string" ? sp.notice : undefined} />

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
          targeting={request.plan}
        />
      ) : (
        <QuoteSection
          locale={locale}
          timeZone={marketTimeZone(request.organization.marketCode)}
          quotes={quotes}
          products={products}
          byId={byId}
          organizationName={request.organization.name}
          paymentTermsDays={paymentTermsDaysFor(request.organization)}
          requestId={request.id}
          totalQuoteLines={totalQuoteLines}
          allAccepted={allAccepted}
          orders={orders}
          renewalRequested={renewalRequested}
          canAccept={canAccept}
          canEdit={canEdit}
          supersededQuotes={supersededQuotes.map((q) => ({
            id: q.id,
            revision: q.revision,
            currency: q.currency,
            total: Number(q.total),
            supersededAt: q.supersededAt,
            replacedBy: q.nextRevision,
          }))}
        />
      )}

      <BackOutSection
        locale={locale}
        requestId={request.id}
        requestStatus={request.status}
        withdrawnAt={request.withdrawnAt}
        quotes={quotes.map((q) => ({
          id: q.id,
          status: q.status,
          currency: q.currency,
          order: q.order ? { id: q.order.id } : null,
        }))}
        canAccept={canAccept}
        canEdit={canEdit}
      />

      {orders.length > 0 ? (
        <OrderSection
          locale={locale}
          orders={orders}
          orderLinks={quotes.flatMap((q) =>
            q.order ? [{ id: q.order.id, currency: q.currency }] : [],
          )}
          byId={byId}
          orderInvoice={orderInvoice}
        />
      ) : null}
    </>
  );
}
