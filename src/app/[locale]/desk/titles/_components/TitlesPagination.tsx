import { getTranslations } from "next-intl/server";

type Props = {
  locale: string;
  page: number;
  totalPages: number;
  /** Builds the query string for a given page, preserving active filters. */
  pageQuery: (p: number) => string;
};

export async function TitlesPagination({ locale, page, totalPages, pageQuery }: Props) {
  const t = await getTranslations({ locale, namespace: "deskTitles" });

  return totalPages > 1 ? (
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
  ) : null;
}
