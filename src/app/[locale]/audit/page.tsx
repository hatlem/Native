import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { loadScope } from "@/lib/scope";
import { intlLocale } from "@/lib/money";
import { Pager } from "@/components/pager";
import { pageHref, pageWindow, parsePageParam } from "@/lib/pagination";
import {
  CUSTOMER_AUDIT_CATEGORIES,
  canReadCustomerAudit,
  customerAuditActionKey,
  dayAfter,
  isCustomerAuditCategory,
  parseAuditDate,
  type CustomerAuditActor,
} from "@/lib/customer-audit";
import { countCustomerAudit, loadCustomerAudit } from "@/lib/customer-audit-load";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function one(v: string | string[] | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

// The organisation's own audit trail: who did what, and when — including when
// NativeSpin staff opened the workspace. Admins of the active organisation
// only; what is shown is an explicit allowlist (lib/customer-audit.ts), and
// the organisation always comes from the session, never from the URL.
export default async function CustomerAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "customerAudit" });

  const scope = await loadScope();
  if (!scope.workspace) redirect(`/${locale}/signin`);
  const orgId = canReadCustomerAudit(scope.workspace);
  if (!orgId) {
    return (
      <>
        <header className="page-header">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
        </header>
        <div className="card">
          <h2>{t("adminsOnlyTitle")}</h2>
          <p className="muted">{t("adminsOnlyBody")}</p>
        </div>
      </>
    );
  }

  const categoryParam = one(sp.category);
  const category = isCustomerAuditCategory(categoryParam) ? categoryParam : null;
  const fromRaw = one(sp.from);
  const toRaw = one(sp.to);
  const from = parseAuditDate(fromRaw);
  const toDay = parseAuditDate(toRaw);
  const filters = { category, from, to: toDay ? dayAfter(toDay) : null };

  const total = await countCustomerAudit(orgId, filters);
  const { page, pageCount, skip, take } = pageWindow(parsePageParam(sp.page), total, PAGE_SIZE);
  const rows = await loadCustomerAudit(orgId, filters, { skip, take });

  const linkParams = {
    category: category ?? undefined,
    from: from ? fromRaw : undefined,
    to: toDay ? toRaw : undefined,
  };
  const exportQs = new URLSearchParams();
  for (const [k, v] of Object.entries(linkParams)) if (v) exportQs.set(k, v);
  const exportHref = `/api/export/audit${exportQs.size ? `?${exportQs}` : ""}`;

  const when = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });
  const who = (a: CustomerAuditActor): string => {
    switch (a.kind) {
      case "member":
        return a.label;
      case "staff":
        return t("actorStaff");
      case "system":
        return t("actorSystem");
      case "other":
        return t("actorOther");
    }
  };
  const fieldLabel = (key: string) => (t.has(`fields.${key}`) ? t(`fields.${key}`) : key);
  const hasFilters = Boolean(category || from || toDay);

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
            <label htmlFor="audit-category">{t("filterCategory")}</label>
            <select id="audit-category" name="category" defaultValue={category ?? ""}>
              <option value="">{t("allCategories")}</option>
              {CUSTOMER_AUDIT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="audit-from">{t("filterFrom")}</label>
            <input id="audit-from" type="date" name="from" defaultValue={from ? fromRaw : ""} />
          </div>
          <div className="field">
            <label htmlFor="audit-to">{t("filterTo")}</label>
            <input id="audit-to" type="date" name="to" defaultValue={toDay ? toRaw : ""} />
          </div>
        </div>
        <div className="actions">
          <button type="submit" className="btn primary">
            {t("filterButton")}
          </button>
          {hasFilters ? (
            <Link href="/audit" className="btn secondary">
              {t("clear")}
            </Link>
          ) : null}
          {/* A file download, so a plain <a>. Same filters, same scope. */}
          <a className="small-link" href={exportHref} download>
            {t("exportCsv")}
          </a>
        </div>
      </form>

      <section className="section">
        <p className="muted small" role="status">
          {t("resultCount", { count: total })}
        </p>
        {rows.length === 0 ? (
          <p className="muted">{t("none")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("colWhen")}</th>
                  <th scope="col">{t("colWho")}</th>
                  <th scope="col">{t("colWhat")}</th>
                  <th scope="col">{t("colDetail")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label={t("colWhen")}>
                      <time dateTime={r.createdAt.toISOString()}>{when.format(r.createdAt)}</time>
                    </td>
                    <td data-label={t("colWho")}>{who(r.actor)}</td>
                    <td data-label={t("colWhat")}>
                      {t(`actions.${customerAuditActionKey(r.action)}`)}
                      <div className="muted small">{t(`categories.${r.category}`)}</div>
                    </td>
                    <td data-label={t("colDetail")} className="muted small">
                      {r.detail.length === 0
                        ? "—"
                        : r.detail.map(([k, v]) => (
                            <div key={k}>
                              {fieldLabel(k)}: {v}
                            </div>
                          ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager locale={locale} page={page} pageCount={pageCount} hrefFor={(p) => pageHref("/audit", linkParams, p)} />
        <p className="muted small" style={{ marginTop: "1rem" }}>
          {t("retentionNote")}
        </p>
      </section>
    </>
  );
}
