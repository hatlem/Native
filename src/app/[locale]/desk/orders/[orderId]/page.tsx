import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { clicksByOrderLine } from "@/lib/metrics/store";
import { OrderHeader } from "./order-header";
import { CancelledSummary } from "./cancelled-summary";
import { LinesSection } from "./lines-section";
import { WritersPanel } from "./writers-panel";
import { CampaignSection } from "./campaign-section";
import { ProgrammePanel } from "./programme-panel";

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
      quote: true,
      invoices: true,
      creditNotes: true,
      lines: {
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
  const invoice = order.invoices[0];

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

      <OrderHeader locale={locale} order={order} invoice={invoice} />

      {cancelError ? (
        <div className="banner-error" role="alert">
          <strong>{t("cancelError")}:</strong> {cancelError}
        </div>
      ) : null}

      <CancelledSummary locale={locale} order={order} invoice={invoice} />

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
