import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { createApiKey, revokeApiKey } from "@/app/admin-actions";
import { MailLink, SubmitButton } from "@/components";

export const dynamic = "force-dynamic";

const ISSUED_KEY_COOKIE = "ns_issued_key";

// Super-admin issuance page for the public catalog API. The raw
// token is surfaced exactly once via an httpOnly flash cookie set
// by the createApiKey action — read it here, render it inline, then
// clear the cookie so a refresh shows nothing and the URL stays
// token-free.
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
  // Unauthenticated → bounce to signin so the next-auth callback URL
  // lands them back here. Authenticated but wrong role → render an
  // explicit permission-denied state below so DESK users don't get
  // silently looped through /signin → /desk and conclude "this link
  // is broken".
  if (!session?.user) {
    redirect(`/${locale}/signin`);
  }
  const t = await getTranslations({ locale, namespace: "apiKeys" });
  if (session.user.role !== "SUPERADMIN") {
    return (
      <section className="section">
        <header className="page-header">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("deniedTitle")}</h1>
          <p className="lead">{t("deniedLead")}</p>
        </header>
        <div className="card">
          <p>{t("deniedBody")}</p>
          <p className="cluster" style={{ marginTop: 16 }}>
            <MailLink
              to="desk@nativespin.com"
              subject="API key access — NativeSpin"
              className="btn small secondary"
            >
              {t("deniedCta")}
            </MailLink>
            <Link href="/desk" className="btn small ghost">
              {t("deniedBack")}
            </Link>
          </p>
        </div>
      </section>
    );
  }

  // Read the one-time flash cookie set by createApiKey. We deliberately
  // do NOT clear it here — `cookies().set()` throws in Next.js 15 server
  // components. The cookie has a 120-second `maxAge` set by the action
  // and is path-scoped to this page only, which gives the admin time to
  // copy the token and is gone before any cache/log retention matters.
  // A refresh within those 120s re-shows the same banner to the same
  // authenticated SUPERADMIN — acceptable since the token was already
  // displayed to that exact session.
  const cookieStore = await cookies();
  const raw = cookieStore.get(ISSUED_KEY_COOKIE)?.value;
  let tokenOnce: string | null = null;
  let created: string | null = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { id?: string; token?: string };
      if (parsed.id && parsed.token) {
        created = parsed.id;
        tokenOnce = parsed.token;
      }
    } catch {
      // Ignore — corrupted cookie is treated as "no recent issuance".
    }
  }
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
            <SubmitButton
              label={t("issueSubmit")}
              pendingLabel={t("issuing")}
              className="btn"
            />
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
                        // §17 — Revoke is irreversible. Hide the actual
                        // submit behind a <details> disclosure so the
                        // first click expands a confirmation block; the
                        // second click is the real revoke. No reason
                        // field (the audit log already captures
                        // actor + timestamp on the action).
                        <details className="spec-details">
                          <summary>
                            <span className="btn small ghost">
                              {t("revoke")}
                            </span>
                          </summary>
                          <form
                            action={revokeApiKey}
                            className="product-form"
                          >
                            <input
                              type="hidden"
                              name="locale"
                              value={locale}
                            />
                            <input
                              type="hidden"
                              name="keyId"
                              value={k.id}
                            />
                            <p
                              className="muted small"
                              style={{ margin: "8px 0" }}
                            >
                              {t("revokeConfirm")}
                            </p>
                            <div className="actions">
                              <SubmitButton
                                label={t("revokeConfirmCta")}
                                pendingLabel={t("revoking")}
                                className="btn small ghost"
                              />
                            </div>
                          </form>
                        </details>
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
