import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { createApiKey, revokeApiKey } from "@/app/admin-actions";

export const dynamic = "force-dynamic";

// Super-admin issuance page for the public catalog API. The raw
// token is surfaced exactly once via the ?token search param the
// createApiKey action sets — copy it now, after the next navigation
// only the SHA-256 hash remains in the DB.
export default async function ApiKeysPage({
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
    redirect(`/${locale}/signin`);
  }

  const t = await getTranslations({ locale, namespace: "apiKeys" });

  const created = typeof sp.created === "string" ? sp.created : null;
  const tokenOnce = typeof sp.token === "string" ? sp.token : null;
  const errCode = typeof sp.error === "string" ? sp.error : null;

  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      organization: { select: { name: true } },
    },
  });

  const orgs = await prisma.organization.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
    take: 200,
  });

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>

      {tokenOnce && created ? (
        <div className="banner-info" role="status">
          <span>
            <strong>{t("createdLabel")}:</strong> <code>{tokenOnce}</code>{" "}
            — {t("copyNow")}
          </span>
        </div>
      ) : null}

      {errCode ? (
        <div className="banner-error" role="alert">
          <span>{t("errorScopes")}</span>
        </div>
      ) : null}

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("issueEyebrow")}</span>
            <h2>{t("issueTitle")}</h2>
          </div>
        </div>
        <form action={createApiKey} className="product-form">
          <input type="hidden" name="locale" value={locale} />
          <div className="field">
            <label htmlFor="key-name">{t("nameLabel")}</label>
            <input
              id="key-name"
              name="name"
              required
              placeholder="e.g. GroupM Atlas"
            />
          </div>
          <div className="field">
            <label htmlFor="key-org">{t("orgLabel")}</label>
            <select id="key-org" name="organizationId" defaultValue="">
              <option value="">— {t("orgPlatform")} —</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="key-scopes">{t("scopesLabel")}</label>
            <input
              id="key-scopes"
              name="scopes"
              defaultValue="catalog:read"
              required
            />
            <span className="hint">{t("scopesHint")}</span>
          </div>
          <div className="field">
            <label htmlFor="key-ttl">{t("ttlLabel")}</label>
            <input
              id="key-ttl"
              name="ttlDays"
              type="number"
              min="1"
              max="1825"
              placeholder={t("ttlPlaceholder")}
            />
            <span className="hint">{t("ttlHint")}</span>
          </div>
          <div className="actions">
            <button type="submit" className="btn">
              {t("issueSubmit")}
            </button>
          </div>
        </form>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("listEyebrow")}</span>
            <h2>{t("listTitle")}</h2>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("colName")}</th>
                <th>{t("colOrg")}</th>
                <th>{t("colScopes")}</th>
                <th>{t("colCreated")}</th>
                <th>{t("colLastUsed")}</th>
                <th>{t("colStatus")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const status = k.revokedAt
                  ? "revoked"
                  : k.expiresAt && k.expiresAt.getTime() <= Date.now()
                    ? "expired"
                    : "active";
                return (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td className="muted">
                      {k.organization?.name ?? "— platform —"}
                    </td>
                    <td className="muted small">{k.scopes}</td>
                    <td className="muted small">
                      {k.createdAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="muted small">
                      {k.lastUsedAt
                        ? k.lastUsedAt.toISOString().slice(0, 10)
                        : "—"}
                    </td>
                    <td>
                      <span
                        className={
                          status === "revoked"
                            ? "badge badge-danger dotless"
                            : status === "expired"
                              ? "badge badge-warning dotless"
                              : "badge badge-success dotless"
                        }
                      >
                        {t(`status_${status}`)}
                      </span>
                    </td>
                    <td>
                      {status === "active" ? (
                        <form action={revokeApiKey}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="keyId" value={k.id} />
                          <button type="submit" className="btn small ghost">
                            {t("revoke")}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="muted small" style={{ marginTop: 16 }}>
          {t("docsHintPrefix")}{" "}
          <Link href="/api" className="link">
            /api
          </Link>
          .
        </p>
      </section>
    </>
  );
}
