import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { superadminPageGate } from "@/lib/desk-guard";
import { SuperadminOnly } from "@/components/superadmin-only";
import { Link } from "@/i18n/navigation";
import { intlLocale } from "@/lib/money";
import {
  loadTotal,
  loadRows,
  loadUsers,
  loadOrgs,
} from "@/lib/data/desk/audit";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
// Detail is JSON; the table shows the start and the title attribute the rest.
const DETAIL_PREVIEW = 160;

function str(sp: Record<string, string | string[] | undefined>, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v.trim().slice(0, 200) : "";
}

// The audit trail, readable. Until this page existed the AuditLog table was
// write-only: rows were only ever looked up as idempotency markers, so "who
// changed this?" meant a database console. Super admin only — the trail
// spans every tenant.
export default async function DeskAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "deskAudit" });
  const gate = await superadminPageGate(locale);
  if (!gate.allowed) return <SuperadminOnly locale={locale} area={t("title")} />;
  const ctx = gate.ctx;

  const sp = await searchParams;
  const actor = str(sp, "actor");
  const action = str(sp, "action");
  const org = str(sp, "org");
  const pageParam = parseInt(str(sp, "page") || "1", 10);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  const where: Prisma.AuditLogWhereInput = {
    ...(actor ? { actor } : {}),
    // Prefix match: "auth." lists every sign-in event, "invoice.issue" one kind.
    ...(action ? { action: { startsWith: action } } : {}),
    ...(org ? { organizationId: org } : {}),
  };

  const [total, rows] = await Promise.all([
    loadTotal(ctx, { where }),
    loadRows(ctx, { where, page, PAGE_SIZE }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Names for the ids on this page only — never a join across the table.
  const userIds = [...new Set(rows.map((r) => r.actor))];
  const orgIds = [...new Set(rows.map((r) => r.organizationId).filter((id): id is string => !!id))];
  const [users, orgs] = await Promise.all([
    userIds.length
      ? loadUsers(ctx, { userIds })
      : [],
    orgIds.length
      ? loadOrgs(ctx, { orgIds })
      : [],
  ]);
  const userById = new Map(users.map((u) => [u.id, u.name || u.email]));
  const orgById = new Map(orgs.map((o) => [o.id, o.name]));

  const when = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "medium" });
  const href = (over: Record<string, string>) => {
    const qs = new URLSearchParams();
    const merged = { actor, action, org, page: page === 1 ? "" : String(page), ...over };
    for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
    const s = qs.toString();
    return `/desk/audit${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>

      {/* GET form: the filters live in the URL, so a view can be shared. */}
      <form method="get" className="product-form">
        <div className="grid">
          <div className="field">
            <label htmlFor="audit-actor">{t("filterActor")}</label>
            <input id="audit-actor" name="actor" defaultValue={actor} placeholder={t("filterActorPlaceholder")} />
          </div>
          <div className="field">
            <label htmlFor="audit-action">{t("filterAction")}</label>
            <input id="audit-action" name="action" defaultValue={action} placeholder={t("filterActionPlaceholder")} />
          </div>
          <div className="field">
            <label htmlFor="audit-org">{t("filterOrg")}</label>
            <input id="audit-org" name="org" defaultValue={org} />
          </div>
        </div>
        <div className="actions">
          <button type="submit" className="btn primary">
            {t("filterButton")}
          </button>
          {actor || action || org ? (
            <Link href="/desk/audit" className="btn secondary">
              {t("clear")}
            </Link>
          ) : null}
        </div>
      </form>

      <section className="section">
        <div className="section-head">
          <span className="muted small">{t("resultCount", { count: total })}</span>
          <span className="muted small">{t("retentionNote")}</span>
        </div>
        {rows.length === 0 ? (
          <p className="muted">{t("none")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("colWhen")}</th>
                  <th>{t("colActor")}</th>
                  <th>{t("colAction")}</th>
                  <th>{t("colEntity")}</th>
                  <th>{t("colOrg")}</th>
                  <th>{t("colDetail")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label={t("colWhen")} style={{ whiteSpace: "nowrap" }}>
                      {when.format(r.createdAt)}
                    </td>
                    <td data-label={t("colActor")}>
                      <Link href={href({ actor: r.actor, page: "" })} className="small-link">
                        {userById.get(r.actor) ?? r.actor}
                      </Link>
                    </td>
                    <td data-label={t("colAction")}>
                      <Link href={href({ action: r.action, page: "" })} className="small-link">
                        <code>{r.action}</code>
                      </Link>
                    </td>
                    <td data-label={t("colEntity")}>
                      <code>{r.entity}</code>
                    </td>
                    <td data-label={t("colOrg")}>
                      {r.organizationId ? (
                        <Link href={href({ org: r.organizationId, page: "" })} className="small-link">
                          {orgById.get(r.organizationId) ?? r.organizationId}
                        </Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td data-label={t("colDetail")} className="small" title={r.detail ?? undefined}>
                      {r.detail ? (
                        <code>
                          {r.detail.length > DETAIL_PREVIEW ? `${r.detail.slice(0, DETAIL_PREVIEW)}…` : r.detail}
                        </code>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 ? (
          <nav className="cluster" aria-label={t("pageOf", { page, pages: pageCount })}>
            {page > 1 ? (
              <Link href={href({ page: page - 1 === 1 ? "" : String(page - 1) })} className="btn secondary small">
                {t("prev")}
              </Link>
            ) : null}
            <span className="muted small">{t("pageOf", { page, pages: pageCount })}</span>
            {page < pageCount ? (
              <Link href={href({ page: String(page + 1) })} className="btn secondary small">
                {t("next")}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </>
  );
}
