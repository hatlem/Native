import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { resolveEffectiveAsset } from "@/lib/writers/placement";
import { StatusBadge } from "@/app/status-badge";
import { EmptyState } from "@/app/empty-state";
import { intlLocale } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function WriterHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  const role = session?.user?.role;
  if (
    !session?.user ||
    (role !== "CONTENT" && role !== "DESK" && role !== "SUPERADMIN")
  ) {
    redirect(`/${locale}/signin`);
  }

  const t = await getTranslations({ locale, namespace: "writer" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tMarket = await getTranslations({ locale, namespace: "market" });

  const profile = await prisma.writerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  const lines = profile
    ? await prisma.orderLine.findMany({
        where: { assignedWriterId: profile.id },
        select: {
          id: true,
          productId: true,
          assignedAt: true,
          articlePlacement: {
            select: {
              articleId: true,
              lockedAssetId: true,
            },
          },
          order: { select: { status: true } },
        },
        orderBy: { assignedAt: "desc" },
      })
    : [];

  // Version-locking-aware status: the locked version once the placement is
  // FINAL-locked, otherwise the article's latest — never just "the newest
  // version", which can belong to a sibling placement's draft on a shared
  // article. Resolve all lines before the JSX since the render below is a
  // synchronous .map(). See orders/[orderId]/page.tsx for the same pattern.
  const effectiveAssets = new Map<string, Awaited<ReturnType<typeof resolveEffectiveAsset>>>();
  for (const line of lines) {
    if (!line.articlePlacement) continue;
    effectiveAssets.set(line.id, await resolveEffectiveAsset(line.articlePlacement));
  }

  // Resolve products separately (OrderLine has no direct product relation)
  const productIds = lines
    .map((l) => l.productId)
    .filter((id): id is string => !!id);
  const products =
    productIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            type: true,
            title: { select: { name: true, countryCode: true } },
          },
        })
      : [];
  const productById = new Map(products.map((p) => [p.id, p]));
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" });
  const marketLabel = (code: string) => (tMarket.has(code) ? tMarket(code) : code);

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("home.title")}</h1>
        <p className="lead">{t("home.lead")}</p>
        <p className="cluster" style={{ marginTop: 12 }}>
          <Link href="/writer/profile" className="btn small secondary">
            {t("home.profileCta")}
          </Link>
        </p>
      </header>

      <section className="section">
        {lines.length === 0 ? (
          <EmptyState title={t("home.emptyTitle")} hint={t("home.emptyBody")} />
        ) : (
          <div className="table-wrap responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("home.colTitle")}</th>
                  <th>{t("home.colFormat")}</th>
                  <th>{t("home.colMarket")}</th>
                  <th>{t("home.colStatus")}</th>
                  <th>{t("home.colAssigned")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const product = line.productId ? productById.get(line.productId) : undefined;
                  const asset = effectiveAssets.get(line.id);
                  return (
                    <tr key={line.id}>
                      <td data-label={t("home.colTitle")}>
                        <Link href={`/writer/lines/${line.id}`}>
                          <strong>{product?.title.name ?? t("untitledAssignment")}</strong>
                        </Link>
                      </td>
                      <td data-label={t("home.colFormat")}>
                        {product ? tType(product.type) : "—"}
                      </td>
                      <td data-label={t("home.colMarket")}>
                        {product ? marketLabel(product.title.countryCode) : "—"}
                      </td>
                      <td data-label={t("home.colStatus")}>
                        {line.order.status === "CANCELLED" ? (
                          <StatusBadge value="CANCELLED" />
                        ) : asset ? (
                          <StatusBadge value={asset.status} />
                        ) : (
                          <span className="badge badge-neutral">{t("status.notStarted")}</span>
                        )}
                      </td>
                      <td className="muted small" data-label={t("home.colAssigned")}>
                        {line.assignedAt ? dateFmt.format(line.assignedAt) : "—"}
                      </td>
                      <td className="actions-col">
                        <Link href={`/writer/lines/${line.id}`} className="link">
                          {t("home.open")}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
