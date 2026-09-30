import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { lineOrder } from "@/lib/commerce/line-order";
import { marketTimeZone } from "@/lib/markets";
import { Link } from "@/i18n/navigation";
import { clicksByOrderLine } from "@/lib/metrics/store";
import { OrderHeader } from "./order-header";
import { CancelledSummary } from "./cancelled-summary";
import { LinesSection } from "./lines-section";
import { WritersPanel } from "./writers-panel";
import { CampaignSection } from "./campaign-section";
import { ProgrammePanel } from "./programme-panel";
import { AccountingStatus } from "./accounting-status";
import { ExtraWorkPanel } from "./extra-work-panel";
import { loadExtraWorkRates } from "@/lib/content-fee";
import { cancelBlockKey } from "@/lib/cancellation";
import { deliveryGap, nextOrderStatus } from "@/lib/order-lifecycle";

// ?credit= codes from desk-billing-actions issueCreditNote → `order`
// message keys. Unknown codes render nothing rather than raw text.
const CREDIT_ERROR_KEYS: Readonly<Record<string, string>> = {
  "reason-required": "creditErrors.reasonRequired",
  "not-found": "creditErrors.notFound",
  "no-invoice": "creditErrors.noInvoice",
  "already-credited": "creditErrors.alreadyCredited",
  "wrong-order-status": "creditErrors.wrongOrderStatus",
};

function creditErrorKey(code: string | string[] | undefined): string | null {
  return typeof code === "string" ? (CREDIT_ERROR_KEYS[code] ?? null) : null;
}

export const dynamic = "force-dynamic";

export default async function DeskOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, orderId } = await params;
  const sp = await searchParams;
  const cancelError = typeof sp.cancel === "string" ? sp.cancel : undefined;
  const t = await getTranslations({ locale, namespace: "order" });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      organization: true,
      // The buyer's request brief: the per-line brief falls back to it. The
      // quote's extra-work lines show beside the hours added since.
      quote: {
        include: {
          request: { select: { briefSummary: true } },
          lines: { where: { kind: "EXTRA_WORK" }, orderBy: lineOrder() },
        },
      },
      invoices: true,
      creditNotes: true,
      extraWork: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      lines: {
        orderBy: lineOrder(),
        include: {
          brief: true,
          articlePlacement: {
            include: { article: { include: { versions: { orderBy: { version: "desc" } } } } },
          },
          trackedLinks: true,
          booking: {
            include: {
              metrics: true,
              publisher: { select: { name: true } },
              title: { select: { name: true } },
            },
          },
        },
      },
      writerPool: {
        select: {
          writerId: true,
          writer: {
            select: { user: { select: { name: true, email: true } } },
          },
        },
      },
    },
  });
  if (!order) notFound();

  const metricsRequests = await prisma.metricsRequest.findMany({
    where: { orderId: order.id },
    select: {
      id: true,
      publisherId: true,
      status: true,
      recipientEmail: true,
      sentCount: true,
      token: true,
    },
  });
  const clicks = await clicksByOrderLine(order.lines.map((l) => l.id));
  const extraWorkRates = await loadExtraWorkRates();

  const products = await prisma.product.findMany({
    where: {
      id: {
        in: order.lines
          .map((l) => l.productId)
          .filter((id): id is string => !!id),
      },
    },
    include: { title: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  // The order's current invoice: an open one if any, else the latest
  // (a credited invoice stays visible with its credit note).
  const invoice =
    order.invoices.find((i) => i.status !== "CREDITED" && i.status !== "VOID") ??
    [...order.invoices].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  // What "Advance" would claim, checked against delivery evidence.
  const next = nextOrderStatus(order.status);
  const tNames = await getTranslations({ locale, namespace: "productType" });
  const gap = deliveryGap(
    order.lines.map((l) => {
      const product = l.productId ? byId.get(l.productId) : undefined;
      const titleName = l.booking?.title?.name ?? product?.title.name;
      return {
        id: l.id,
        kind: l.kind,
        booking: l.booking ? { status: l.booking.status, liveUrl: l.booking.liveUrl } : null,
        label: titleName
          ? product
            ? `${titleName} — ${tNames.has(product.type) ? tNames(product.type) : product.type}`
            : titleName
          : t("unknownPlacement"),
      };
    }),
    next,
  );

  const cancelMessage =
    cancelError === "blocked"
      ? cancelBlockKey(order.status)
        ? t(`cancelBlock.${cancelBlockKey(order.status)}`)
        : t("cancelErrors.blocked")
      : cancelError === "reason-required"
        ? t("cancelErrors.reasonRequired")
        : cancelError === "not-found"
          ? t("cancelErrors.notFound")
          : null;
  const creditMessage = creditErrorKey(sp.credit);
  const advanceMessage =
    sp.advance === "unconfirmed"
      ? t("advanceErrors.unconfirmed")
      : sp.advance === "moved"
        ? t("advanceErrors.moved")
        : null;

  // Derive criteria from the first line that has a product/title.
  const firstProductLine = order.lines.find(
    (l) => l.productId != null && byId.has(l.productId),
  );
  const firstProduct = firstProductLine?.productId
    ? byId.get(firstProductLine.productId)
    : undefined;
  const firstLineCountry = firstProduct?.title.countryCode ?? "";
  const firstLineCategory = firstProduct?.title.category ?? "";

  // Phase-4 playbooks: load active playbooks once and match per placement
  // line so the writer sees the relevant guidance inline.
  const playbooks = await prisma.playbook.findMany({ where: { active: true } });
  const matchablePlaybooks = playbooks.map((p) => ({
    ...p,
    productType: p.productType as string | null,
    marketCode: p.marketCode as string | null,
  }));

  return (
    <>
      <nav className="breadcrumb">
        <Link href="/desk/orders" className="small-link">
          ← {t("orders")}
        </Link>
      </nav>

      <OrderHeader
        locale={locale}
        order={order}
        invoice={invoice}
        next={next}
        gap={gap}
      />

      {cancelMessage ? (
        <div className="banner-error" role="alert">
          <strong>{t("cancelError")}:</strong> {cancelMessage}
        </div>
      ) : null}
      {creditMessage ? (
        <div className="banner-error" role="alert">
          <strong>{t("creditError")}:</strong> {t(creditMessage)}
        </div>
      ) : null}
      {advanceMessage ? (
        <div className="banner-error" role="alert">
          <strong>{t("advanceError")}:</strong> {advanceMessage}
        </div>
      ) : null}

      <AccountingStatus locale={locale} orderId={order.id} invoice={invoice} creditNotes={order.creditNotes} />

      <CancelledSummary
        locale={locale}
        order={order}
        invoice={invoice}
        timeZone={marketTimeZone(order.organization.marketCode)}
      />

      <ProgrammePanel locale={locale} orderId={order.id} />

      {["CONFIRMED", "IN_PRODUCTION", "SCHEDULED", "LIVE", "COMPLETED"].includes(order.status) ? (
        <WritersPanel
          locale={locale}
          orderId={order.id}
          poolWriterIds={order.writerPool.map((p) => p.writerId)}
          criteriaCountry={firstLineCountry}
          criteriaCategory={firstLineCategory}
        />
      ) : null}

      <LinesSection
        locale={locale}
        order={order}
        byId={byId}
        matchablePlaybooks={matchablePlaybooks}
        requestBrief={order.quote.request.briefSummary}
      />

      <ExtraWorkPanel
        locale={locale}
        order={{
          id: order.id,
          status: order.status,
          currency: order.quote.currency,
          invoices: order.invoices,
        }}
        entries={order.extraWork}
        quoteLines={order.quote.lines}
        rates={extraWorkRates}
        errorCode={typeof sp.extraWork === "string" ? sp.extraWork : undefined}
      />

      <CampaignSection
        locale={locale}
        order={order}
        metricsRequests={metricsRequests}
        clicks={clicks}
      />
    </>
  );
}
