import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

// Previous / "Page x of y" / Next for server-rendered lists. Renders nothing
// for a single page. The labels reuse the strings the desk users list already
// ships in every locale (deskUsers.prev/next/pageOf).
export async function Pager({
  locale,
  page,
  pageCount,
  hrefFor,
}: {
  locale: string;
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  const t = await getTranslations({ locale, namespace: "deskUsers" });
  return (
    <nav className="pagination" style={{ marginTop: "1rem" }} aria-label={t("pageOf", { page, pages: pageCount })}>
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev">
          ← {t("prev")}
        </Link>
      ) : null}
      <span className="muted small">{t("pageOf", { page, pages: pageCount })}</span>
      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} rel="next">
          {t("next")} →
        </Link>
      ) : null}
    </nav>
  );
}
