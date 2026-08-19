import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { loadScope } from "@/lib/scope";
import { EmptyState } from "@/app/empty-state";
import { StatusBadge } from "@/app/status-badge";

export const dynamic = "force-dynamic";

export default async function ArticlesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "articles" });

  const scope = await loadScope();
  if (!scope.workspace) redirect(`/${locale}/signin`);

  const articles = await prisma.article.findMany({
    where: { organizationId: { in: scope.workspace.scopeOrgIds } },
    orderBy: { updatedAt: "desc" },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1, select: { status: true } },
      orderLine: {
        select: {
          orderId: true,
          productId: true,
        },
      },
    },
  });

  const productIds = articles
    .map((a) => a.orderLine?.productId)
    .filter((id): id is string => !!id);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, title: { select: { name: true } } },
      })
    : [];
  const titleByProductId = new Map(products.map((p) => [p.id, p.title.name]));

  const authorIds = [...new Set(articles.map((a) => a.createdByUserId))];
  const authors = authorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const authorNameById = new Map(authors.map((u) => [u.id, u.name ?? u.email]));

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("subtitle")}</p>
      </header>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("eyebrow")}</span>
            <h2>{t("title")}</h2>
          </div>
          <Link href="/articles/new" className="btn small secondary">
            {t("newArticleCta")}
          </Link>
        </div>

        {articles.length === 0 ? (
          <EmptyState
            title={t("none")}
            primaryHref="/articles/new"
            primaryLabel={t("newArticleCta")}
          />
        ) : (
          <div className="table-wrap responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("colTitle")}</th>
                  <th>{t("colStatus")}</th>
                  <th>{t("colAuthor")}</th>
                  <th>{t("colPlacement")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {articles.map((a) => {
                  const status = a.versions[0]?.status ?? "DRAFT";
                  const placementName = a.orderLine?.productId
                    ? titleByProductId.get(a.orderLine.productId)
                    : null;
                  return (
                    <tr key={a.id}>
                      <td data-label={t("colTitle")}>
                        <Link href={`/articles/${a.id}`}>{a.title}</Link>
                      </td>
                      <td data-label={t("colStatus")}>
                        <StatusBadge value={status} />
                      </td>
                      <td data-label={t("colAuthor")}>
                        {authorNameById.get(a.createdByUserId) ?? "—"}
                      </td>
                      <td data-label={t("colPlacement")}>
                        {a.orderLine ? (
                          <Link href={`/orders/${a.orderLine.orderId}`}>
                            {placementName ?? t("colPlacement")}
                          </Link>
                        ) : (
                          <span className="badge badge-neutral">{t("notLinked")}</span>
                        )}
                      </td>
                      <td className="actions-col">
                        <Link href={`/articles/${a.id}`} className="link">
                          {t("view")}
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
