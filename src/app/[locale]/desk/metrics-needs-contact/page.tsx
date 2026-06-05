import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

export default async function MetricsNeedsContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }

  const t = await getTranslations({ locale, namespace: "desk" });

  const rows = await prisma.metricsRequest.findMany({
    where: { status: "NEEDS_CONTACT" },
    include: {
      publisher: { select: { name: true } },
      order: { select: { id: true } },
      _count: { select: { bookings: true } },
    },
    orderBy: { createdAt: "desc" },
  });

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
