import { getTranslations } from "next-intl/server";
import { viewOrgIds } from "@/lib/workspace";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { loadScope } from "@/lib/scope";
import { EmptyState } from "@/app/empty-state";
import { StatusBadge } from "@/app/status-badge";
import { articleHeadline } from "@/lib/content/markdown";
import { SafeEmail } from "@/components/safe-email";
import type { ReactNode } from "react";

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
    where: { organizationId: { in: viewOrgIds(scope.workspace) } },
    orderBy: { updatedAt: "desc" },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          status: true,
          body: true,
          authorWriter: { select: { user: { select: { name: true, email: true } } } },
        },
      },
      assignedWriter: { select: { user: { select: { name: true, email: true } } } },
      placements: {
        select: {
          orderLine: {
            select: {
              orderId: true,
              productId: true,
            },
          },
        },
      },
    },
  });

  const productIds = articles
    .flatMap((a) => a.placements.map((p) => p.orderLine.productId))
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
  // A name, or the address through SafeEmail — never a bare SSR email text
  // node (Cloudflare obfuscation breaks hydration, see safe-email.tsx).
  const authorNameById = new Map(
    authors.map((u) => [u.id, u.name ?? <SafeEmail address={u.email} />] as const),
  );
  // The author is whoever actually wrote the text — the latest version's
  // writer, else the assigned writer — and only then whoever created the
  // Article row (for writer-produced articles that is the desk user who
  // staffed the line, not the author).
  const authorOf = (a: (typeof articles)[number]): ReactNode => {
    const writer = a.versions[0]?.authorWriter?.user ?? a.assignedWriter?.user;
    if (writer) return writer.name ?? writer.email.split("@")[0];
    return authorNameById.get(a.createdByUserId) ?? null;
  };

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
                  return (
                    <tr key={a.id}>
                      <td data-label={t("colTitle")}>
                        {/* Headline from the draft; the Article.title is the
                            publication the piece was born for. */}
                        <Link href={`/articles/${a.id}`}>
                          {articleHeadline(a.versions[0]?.body) ?? a.title}
                        </Link>
                        {articleHeadline(a.versions[0]?.body) ? (
                          <div className="muted small">{a.title}</div>
                        ) : null}
                      </td>
                      <td data-label={t("colStatus")}>
                        <StatusBadge value={status} />
                      </td>
                      <td data-label={t("colAuthor")}>
                        {authorOf(a) ?? "—"}
                      </td>
                      <td data-label={t("colPlacement")}>
                        {a.placements.length > 0 ? (
                          <ul className="cluster tight" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                            {a.placements.map((p, i) => (
                              <li key={i}>
                                <Link href={`/orders/${p.orderLine.orderId}`}>
                                  {p.orderLine.productId
                                    ? (titleByProductId.get(p.orderLine.productId) ?? t("colPlacement"))
                                    : t("colPlacement")}
                                </Link>
                              </li>
                            ))}
                          </ul>
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
