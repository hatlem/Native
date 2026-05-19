import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { BookingStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { updateBooking } from "@/app/publisher-actions";
import { StatusBadge } from "@/app/status-badge";

export const dynamic = "force-dynamic";

const BOOKING_STATUSES = Object.values(BookingStatus);

export default async function PublisherOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "publisher" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  const session = await auth();
  const me = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: { publisherId: true },
  });
  if (!me?.publisherId) redirect(`/${locale}/signin`);

  const titles = await prisma.title.findMany({
    where: { publisherId: me.publisherId },
    include: { products: { select: { id: true, type: true, name: true } } },
  });
  const productMap = new Map(
    titles.flatMap((title) =>
      title.products.map((p) => [
        p.id,
        { titleName: title.name, type: p.type },
      ]),
    ),
  );
  const productIds = [...productMap.keys()];

  const lines = productIds.length
    ? await prisma.orderLine.findMany({
        where: { productId: { in: productIds } },
        orderBy: { id: "desc" },
        include: { order: true, booking: true },
      })
    : [];

  return (
    <section>
      <p>
        <Link href="/publisher">← {t("title")}</Link>
      </p>
      <h1>{t("ordersTitle")}</h1>

      {lines.length === 0 ? (
        <p className="note">{t("noOrders")}</p>
      ) : (
        <div className="grid">
          {lines.map((line) => {
            const meta = productMap.get(line.productId);
            return (
              <article className="card" key={line.id}>
                <h3>{meta?.titleName ?? line.productId}</h3>
                <div className="muted">
                  {meta ? tType(meta.type) : ""} · {t("status")}:{" "}
                  <StatusBadge value={line.order.status} />
                </div>
                {line.booking ? (
                  <form action={updateBooking} style={{ marginTop: 10 }}>
                    <input type="hidden" name="locale" value={locale} />
                    <input
                      type="hidden"
                      name="bookingId"
                      value={line.booking.id}
                    />
                    <label className="muted" htmlFor={`bs-${line.id}`}>
                      {t("booking")}
                    </label>
                    <select
                      id={`bs-${line.id}`}
                      name="status"
                      defaultValue={line.booking.status}
                    >
                      {BOOKING_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <label className="muted" htmlFor={`lu-${line.id}`}>
                      {t("liveUrl")}
                    </label>
                    <input
                      id={`lu-${line.id}`}
                      name="liveUrl"
                      defaultValue={line.booking.liveUrl ?? ""}
                    />
                    <button
                      type="submit"
                      style={{ marginTop: 10, display: "block" }}
                    >
                      {t("save")}
                    </button>
                  </form>
                ) : (
                  <p className="note">{t("noBooking")}</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
