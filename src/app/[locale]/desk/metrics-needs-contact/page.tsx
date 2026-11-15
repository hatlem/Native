import { getTranslations } from "next-intl/server";
import { requireDeskContext } from "@/lib/desk-guard";
import { Link } from "@/i18n/navigation";
import {
  loadRows,
} from "@/lib/data/desk/metrics";

export const dynamic = "force-dynamic";

export default async function MetricsNeedsContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ctx = await requireDeskContext(locale);

  const t = await getTranslations({ locale, namespace: "desk" });

  const rows = await loadRows(ctx);

  return (
    <>
      <header className="page-header">
        <h1>{t("metricsNeedsContactTitle")}</h1>
      </header>

      <section className="section">
        {rows.length === 0 ? (
          <p className="muted">{t("metricsNeedsContactEmpty")}</p>
        ) : (
          <div className="table-wrap responsive">
            <table className="table">
              <thead>
                <tr>
                  <th className="text-left">{t("metricsNeedsContactPublisher")}</th>
                  <th>{t("metricsNeedsContactPlacements")}</th>
                  <th>{t("metricsNeedsContactOrder")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td>{r.publisher.name}</td>
                    <td className="text-center num">{r._count.bookings}</td>
                    <td>
                      <Link
                        href={`/desk/orders/${r.order.id}`}
                        className="underline"
                      >
                        {r.order.id.slice(0, 8)}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
