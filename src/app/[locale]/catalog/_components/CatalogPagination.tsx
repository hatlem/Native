import { getTranslations } from "next-intl/server";
import { pageWindow } from "@/lib/catalog-pagination";

// Plain <a>, not next-intl's <Link>: Next.js's client-side (RSC) soft
// navigation is currently broken in production for same-route searchParams
// changes on this page (see CatalogSort.tsx) — a <Link> click here would be
// intercepted by the client router and silently fail. A plain anchor is
// never intercepted, so it always falls through to a full navigation.
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
        <a href={`/${locale}/catalog${pageQuery(page - 1)}`} className="pagination-step">
          ← {t("pagination.prev")}
        </a>
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
            <a
              key={item}
              href={`/${locale}/catalog${pageQuery(item)}`}
              className={`pagination-page${item === page ? " is-current" : ""}`}
              aria-current={item === page ? "page" : undefined}
            >
              {item}
            </a>
          ),
        )}
      </div>

      {page < totalPages ? (
        <a href={`/${locale}/catalog${pageQuery(page + 1)}`} className="pagination-step">
          {t("pagination.next")} →
        </a>
      ) : (
        <span className="pagination-step is-disabled" aria-disabled="true">
          {t("pagination.next")} →
        </span>
      )}
    </nav>
  );
}
