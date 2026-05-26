import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listPendingQuotes } from "@/lib/pricing/quotes";
import { applyQuoteAction, rejectQuoteAction } from "@/app/price-actions";
import { Link } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

export default async function DeskPriceQuotesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (session?.user?.role !== "SUPERADMIN") {
    redirect(`/${locale}/desk`);
  }
  const t = await getTranslations({ locale, namespace: "pendingQuotes" });

  const quotes = await listPendingQuotes({
    marketCode: typeof sp.market === "string" ? sp.market : undefined,
    publisherId: typeof sp.publisher === "string" ? sp.publisher : undefined,
    limit: 100,
  });

  return (
    <section>
      <p>
        <Link href="/desk">← {t("backToDesk")}</Link>
      </p>
      <h1>{t("queueTitle")}</h1>

      {quotes.length === 0 ? (
        <p className="muted" style={{ marginTop: 16 }}>
          {t("queueEmpty")}
        </p>
      ) : (
        <article className="card" style={{ marginTop: 16 }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>
                    {t("col.title")}
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>
                    {t("col.received")}
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>
                    {t("col.price")}
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>
                    {t("col.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => {
                  const titleId =
                    q.product?.titleId ?? q.priceRequest?.titleId ?? "";
                  const titleName =
                    q.product?.title?.name ?? q.priceRequest?.title?.name ?? "—";
                  return (
                    <tr
                      key={q.id}
                      style={{ borderTop: "1px solid var(--border, #e5e7eb)" }}
                    >
                      <td style={{ padding: "10px 8px" }}>
                        <Link href={`/desk/titles/${titleId}`}>
                          <strong>{titleName}</strong>
                        </Link>
                        {q.priceRequest?.salesContact && (
                          <div className="muted small">
                            {q.priceRequest.salesContact.name}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "10px 8px" }}>
                        {q.recordedAt.toISOString().slice(0, 10)}
                      </td>
                      <td style={{ padding: "10px 8px" }}>
                        <strong>
                          {q.price.toString()} {q.currency}
                        </strong>
                      </td>
                      <td style={{ padding: "10px 8px" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          <form action={applyQuoteAction}>
                            <input type="hidden" name="locale" value={locale} />
                            <input
                              type="hidden"
                              name="titleId"
                              value={titleId}
                            />
                            <input
                              type="hidden"
                              name="quoteId"
                              value={q.id}
                            />
                            <button type="submit" className="btn small">
                              {t("apply")}
                            </button>
                          </form>
                          <form action={rejectQuoteAction}>
                            <input type="hidden" name="locale" value={locale} />
                            <input
                              type="hidden"
                              name="titleId"
                              value={titleId}
                            />
                            <input
                              type="hidden"
                              name="quoteId"
                              value={q.id}
                            />
                            <button type="submit" className="btn small">
                              {t("reject")}
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>
      )}
    </section>
  );
}
