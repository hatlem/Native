import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { upcomingMonths } from "@/lib/campaign-schedule";

// Title-level availability at a glance: the next 6 months, each marked open /
// limited / sold-out from the products' Availability blocks. Reuses the same
// month helper the campaign schedule step uses, so the two stay consistent.
export async function AvailabilityStrip({
  locale,
  productIds,
}: {
  locale: string;
  productIds: string[];
}) {
  if (productIds.length === 0) return null;
  const t = await getTranslations({ locale, namespace: "titleDetail" });

  const rows = await prisma.availability.findMany({
    where: { productId: { in: productIds }, blocked: true },
    select: { productId: true, year: true, month: true },
  });
  const blockedByMonth = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = `${r.year}-${r.month}`;
    if (!blockedByMonth.has(k)) blockedByMonth.set(k, new Set());
    blockedByMonth.get(k)!.add(r.productId);
  }

  const total = productIds.length;
  const months = upcomingMonths(6, new Date());
  const fmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <section className="availability-strip" aria-label={t("availabilityTitle")}>
      <h3>{t("availabilityTitle")}</h3>
      <ol className="availability-months">
        {months.map((m) => {
          const blocked = blockedByMonth.get(`${m.year}-${m.month}`)?.size ?? 0;
          const state = blocked === 0 ? "open" : blocked >= total ? "full" : "limited";
          return (
            <li key={m.iso} className={`availability-month is-${state}`}>
              <span className="availability-month-label">
                {fmt.format(new Date(`${m.iso}T00:00:00Z`))}
              </span>
              <span className="availability-month-state">{t(`avail_${state}`)}</span>
            </li>
          );
        })}
      </ol>
      <p className="muted xsmall">{t("availabilityNote")}</p>
    </section>
  );
}
