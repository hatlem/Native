import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/money";
import { getWorkspace } from "@/lib/workspace";
import { createClient, selectClient } from "@/app/agency-actions";
import { MailLink, SubmitButton } from "@/components";

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
  if (!session?.user) {
    redirect(`/${locale}/signin`);
  }
  const ws = await getWorkspace(session.user.id);
  if (!ws?.isAgency || !ws.agencyOrgId) {
    // Signed-in but not an agency org. Previously this fell through to
    // a /signin redirect that bounced back to /catalog — a silent loop
    // from the buyer's POV (Camilla scenario, Bug #9). Show an honest
    // "request agency access" page instead so they know the surface
    // exists but is gated.
    return (
      <section className="section">
        <header className="page-header">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("gatedTitle")}</h1>
          <p className="lead">{t("gatedLead")}</p>
        </header>
        <div className="card">
          <p>{t("gatedBody")}</p>
          <p className="cluster" style={{ marginTop: 16 }}>
            <MailLink
              to="partners@nativespin.com"
              subject="Agency access — NativeSpin"
              className="btn primary"
            >
              {t("gatedCta")}
            </MailLink>
          </p>
        </div>
      </section>
    );
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

  const rollup = new Map<
    string,
    { count: number; spend: number; currency: string }
  >();
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

  const activeName = ws.activeOrgId
    ? (clients.find((c) => c.id === ws.activeOrgId)?.name ?? null)
    : null;

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("subtitle")}</p>
      </header>

      {sp.error ? (
        <div className="banner-error" role="alert">
          <span>{t("error")}</span>
        </div>
      ) : null}

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">{t("active")}</div>
          <div className="value" style={{ fontSize: "1.4rem" }}>
            {activeName ?? t("none")}
          </div>
          {activeName ? (
            <div className="delta">{t("activeSub")}</div>
          ) : (
            <div className="delta">{t("activePrompt")}</div>
          )}
        </div>
        <div className="kpi">
          <div className="label">{t("clients")}</div>
          <div className="value">{clients.length}</div>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("clientsEyebrow")}</span>
            <h2>{t("clients")}</h2>
          </div>
        </div>
        {clients.length === 0 ? (
          <p className="muted">{t("noClients")}</p>
        ) : (
          <div className="grid">
            {clients.map((c) => {
              const r = rollup.get(c.id);
              const isActive = c.id === ws.activeOrgId;
              return (
                <article
                  className={`card client-card ${isActive ? "is-active" : ""}`}
                  key={c.id}
                >
                  <div className="cluster between">
                    <h3>{c.name}</h3>
                    {isActive ? (
                      <span className="badge badge-info dotless">
                        {t("activeBadge")}
                      </span>
                    ) : null}
                  </div>
                  <p className="muted small">{tMarket(c.marketCode)}</p>
                  <dl className="spec-grid">
                    <dt>{t("orders")}</dt>
                    <dd>{r?.count ?? 0}</dd>
                    <dt>{t("spend")}</dt>
                    <dd>
                      {r ? formatMoney(r.spend, r.currency, locale) : "—"}
                    </dd>
                  </dl>
                  {isActive ? (
                    <button
                      type="button"
                      className="btn small block"
                      disabled
                      aria-label={t("activeBadge")}
                    >
                      {t("activeBadge")}
                    </button>
                  ) : (
                    <form action={selectClient} className="client-cta">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="clientId" value={c.id} />
                      <SubmitButton
                        label={t("switch")}
                        pendingLabel={t("switching")}
                        className="btn small block"
                      />
                    </form>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("addClientEyebrow")}</span>
            <h2>{t("addClient")}</h2>
          </div>
        </div>
        <form action={createClient} className="card add-client-form">
          <input type="hidden" name="locale" value={locale} />
          <div className="grid-2">
            <div className="field">
              <label htmlFor="name">{t("clientName")}</label>
              <input id="name" name="name" required />
            </div>
            <div className="field">
              <label htmlFor="market">{t("market")}</label>
              <select id="market" name="market" defaultValue="" required>
                <option value="" disabled>
                  {t("marketPlaceholder")}
                </option>
                {MARKET_CODES.map((m) => (
                  <option key={m} value={m}>
                    {tMarket(m)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="actions">
            <SubmitButton
              label={t("create")}
              pendingLabel={t("creating")}
              className="btn"
            />
          </div>
        </form>
      </section>
    </>
  );
}
