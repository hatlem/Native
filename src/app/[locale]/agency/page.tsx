import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/money";
import { getWorkspace } from "@/lib/workspace";
import { createClient, selectClient } from "@/app/agency-actions";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode);

export default async function AgencyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "agency" });
  const tMarket = await getTranslations({ locale, namespace: "market" });

  const session = await auth();
  const ws = await getWorkspace(session?.user?.id);
  if (!ws?.isAgency || !ws.agencyOrgId) {
    redirect(`/${locale}/signin`);
  }

  const clients = await prisma.organization.findMany({
    where: { parentOrgId: ws.agencyOrgId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, marketCode: true },
  });

  const orders = await prisma.order.findMany({
    where: { organizationId: { in: clients.map((c) => c.id) } },
    select: {
      organizationId: true,
      quote: { select: { currency: true, total: true } },
    },
  });

  const rollup = new Map<string, { count: number; spend: number; currency: string }>();
  for (const o of orders) {
    const cur = rollup.get(o.organizationId) ?? {
      count: 0,
      spend: 0,
      currency: o.quote.currency,
    };
    cur.count += 1;
    cur.spend += Number(o.quote.total);
    cur.currency = o.quote.currency;
    rollup.set(o.organizationId, cur);
  }

  return (
    <section>
      <h1>{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>
      {sp.error ? <p className="note">{t("error")}</p> : null}

      <p className="note">
        {t("active")}:{" "}
        <strong>
          {ws.activeOrgId
            ? (clients.find((c) => c.id === ws.activeOrgId)?.name ??
              t("none"))
            : t("none")}
        </strong>
      </p>

      <h2 style={{ marginTop: 24 }}>{t("clients")}</h2>
      {clients.length === 0 ? (
        <p className="note">{t("noClients")}</p>
      ) : (
        <div className="grid">
          {clients.map((c) => {
            const r = rollup.get(c.id);
            const isActive = c.id === ws.activeOrgId;
            return (
              <article className="card" key={c.id}>
                <h3>{c.name}</h3>
                <div className="muted">{tMarket(c.marketCode)}</div>
                <div className="muted">
                  {t("orders")}: {r?.count ?? 0}
                </div>
                <div className="muted">
                  {t("spend")}:{" "}
                  {r ? formatMoney(r.spend, r.currency, locale) : "—"}
                </div>
                <form action={selectClient} style={{ marginTop: 10 }}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="clientId" value={c.id} />
                  <button type="submit" disabled={isActive}>
                    {isActive ? t("activeBadge") : t("switch")}
                  </button>
                </form>
              </article>
            );
          })}
        </div>
      )}

      <h2 style={{ marginTop: 24 }}>{t("addClient")}</h2>
      <form action={createClient} className="filters">
        <input type="hidden" name="locale" value={locale} />
        <div>
          <label htmlFor="name">{t("clientName")}</label>
          <input id="name" name="name" required />
        </div>
        <div>
          <label htmlFor="market">{t("market")}</label>
          <select id="market" name="market" defaultValue="">
            <option value="" disabled>
              —
            </option>
            {MARKET_CODES.map((m) => (
              <option key={m} value={m}>
                {tMarket(m)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit">{t("create")}</button>
      </form>
    </section>
  );
}
