import { getTranslations } from "next-intl/server";

export async function CatalogPagination({
  locale,
  page,
  totalPages,
  pageQuery,
}: {
  locale: string;
  page: number;
  totalPages: number;
  pageQuery: (p: number) => string;
}) {
  if (totalPages <= 1) return null;
  const t = await getTranslations({ locale, namespace: "catalog" });

  return (
    <nav
      className="pagination"
      style={{
        marginTop: 24,
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}
    >
      {page > 1 ? (
        <a href={pageQuery(page - 1) || "?"}>← {t("pagination.prev")}</a>
      ) : (
        <span className="muted">← {t("pagination.prev")}</span>
      )}
      <span className="muted">
        {t("pagination.page", { page, total: totalPages })}
      </span>
      {page < totalPages ? (
        <a href={pageQuery(page + 1)}>{t("pagination.next")} →</a>
      ) : (
        <span className="muted">{t("pagination.next")} →</span>
      )}
    </nav>
  );
}
