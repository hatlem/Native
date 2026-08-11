import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { pageWindow } from "@/lib/catalog-pagination";

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
  const items = pageWindow(page, totalPages);

  return (
    <nav
      className="pagination"
      aria-label={t("pagination.page", { page, total: totalPages })}
    >
      {page > 1 ? (
        <Link href={`/catalog${pageQuery(page - 1)}`} className="pagination-step">
          ← {t("pagination.prev")}
        </Link>
      ) : (
        <span className="pagination-step is-disabled" aria-disabled="true">
          ← {t("pagination.prev")}
        </span>
      )}

      <div className="pagination-pages">
        {items.map((item, i) =>
          item === "ellipsis" ? (
            <span key={`e${i}`} className="pagination-ellipsis" aria-hidden="true">
              …
            </span>
          ) : (
            <Link
              key={item}
              href={`/catalog${pageQuery(item)}`}
              className={`pagination-page${item === page ? " is-current" : ""}`}
              aria-current={item === page ? "page" : undefined}
            >
              {item}
            </Link>
          ),
        )}
      </div>

      {page < totalPages ? (
        <Link href={`/catalog${pageQuery(page + 1)}`} className="pagination-step">
          {t("pagination.next")} →
        </Link>
      ) : (
        <span className="pagination-step is-disabled" aria-disabled="true">
          {t("pagination.next")} →
        </span>
      )}
    </nav>
  );
}
