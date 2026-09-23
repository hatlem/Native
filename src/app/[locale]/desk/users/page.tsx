import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Prisma, UserRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { SubmitButton } from "@/components";
import { SafeEmail } from "@/components/safe-email";
import { deskUsersOkKey, deskUsersErrorKey } from "@/lib/desk-users-messages";
import {
  updateUserRole,
  updateUserOrg,
  updateUserPublisher,
  setUserDeactivated,
  sendUserPasswordReset,
  sendUserSignInLink,
} from "@/app/user-admin-actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const ROLES = Object.values(UserRole);
const ORG_ROLES = ["ADMIN", "MEMBER", "RESTRICTED"] as const;
// Bound the pickers. A console that renders every organisation into a select
// is fine at this catalogue's scale and quietly stops being fine later; the
// search box is the escape hatch when it does.
const PICKER_LIMIT = 300;

function str(
  sp: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const v = sp[key];
  return typeof v === "string" ? v.trim() : "";
}

// The super-admin user console. Before this existed, every one of these
// operations was a shell script run against the production database
// (scripts/promote-to-desk.ts and friends) — which meant nobody but the
// engineer with the DATABASE_URL could resolve a support case.
export default async function DeskUsersPage({
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
    redirect(`/${locale}/desk`);
  }
  const actorId = session.user.id;

  const t = await getTranslations({ locale, namespace: "deskUsers" });

  const q = str(sp, "q");
  const editId = str(sp, "edit");
  const pageParam = parseInt(str(sp, "page") || "1", 10);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  const where: Prisma.UserWhereInput = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};

  const [total, users, orgs, publishers] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        deactivatedAt: true,
        emailVerifiedAt: true,
        lastSignInAt: true,
        publisherId: true,
        organization: { select: { id: true, name: true } },
        publisher: { select: { id: true, name: true } },
        memberships: {
          select: { organizationId: true, role: true, status: true },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.organization.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: PICKER_LIMIT,
    }),
    prisma.publisher.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: PICKER_LIMIT,
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const editing = editId ? users.find((u) => u.id === editId) : undefined;

  const okKey = deskUsersOkKey(str(sp, "ok"));
  const errKey = deskUsersErrorKey(str(sp, "error"));

  // Carried into every action so a save returns to the same filtered page.
  const context = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="q" value={q} />
      <input type="hidden" name="page" value={String(page)} />
    </>
  );

  const listHref = (over: Record<string, string>) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (page !== 1) params.set("page", String(page));
    for (const [k, v] of Object.entries(over)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    const qs = params.toString();
    return `/desk/users${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>

      {okKey ? (
        <div className="banner-info" role="status">
          <span>{t(okKey)}</span>
        </div>
      ) : null}
      {errKey ? (
        <div className="banner-error" role="alert">
          <span>{t(errKey)}</span>
        </div>
      ) : null}

      <form method="get" className="result-bar">
        <div className="field" style={{ margin: 0, flex: 1 }}>
          <label htmlFor="user-q">{t("searchLabel")}</label>
          <input
            id="user-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder={t("searchPlaceholder")}
          />
        </div>
        <button type="submit" className="btn secondary">
          {t("searchButton")}
        </button>
      </form>

      {editing ? (
        <section className="section" id="edit">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("editEyebrow")}</span>
              <h2>{editing.name || editing.email}</h2>
            </div>
            <Link href={listHref({ edit: "" })}>{t("editClose")}</Link>
          </div>

          {editing.id === actorId ? (
            // The guards in @/lib/user-admin refuse self-targeted changes; say
            // so up front rather than letting the admin submit into a wall.
            <p className="muted">{t("selfNotice")}</p>
          ) : (
            <div className="card stack-4">
              <form action={updateUserRole} className="product-form">
                {context}
                <input type="hidden" name="userId" value={editing.id} />
                <div className="field">
                  <label htmlFor="edit-role">{t("colRole")}</label>
                  <select id="edit-role" name="role" defaultValue={editing.role}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <span className="hint">{t("roleHint")}</span>
                </div>
                <SubmitButton
                  className="btn"
                  label={t("saveRole")}
                  pendingLabel={t("saving")}
                />
              </form>

              <form action={updateUserOrg} className="product-form">
                {context}
                <input type="hidden" name="userId" value={editing.id} />
                <div className="field">
                  <label htmlFor="edit-org">{t("colOrg")}</label>
                  <select
                    id="edit-org"
                    name="organizationId"
                    defaultValue={editing.organization?.id ?? ""}
                  >
                    <option value="">{t("orgNone")}</option>
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="edit-org-role">{t("seatLabel")}</label>
                  <select
                    id="edit-org-role"
                    name="orgRole"
                    defaultValue={
                      editing.memberships.find(
                        (m) => m.organizationId === editing.organization?.id,
                      )?.role ?? ""
                    }
                  >
                    <option value="">{t("seatUnchanged")}</option>
                    {ORG_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <span className="hint">{t("seatHint")}</span>
                </div>
                <SubmitButton
                  className="btn"
                  label={t("saveOrg")}
                  pendingLabel={t("saving")}
                />
              </form>

              <form action={updateUserPublisher} className="product-form">
                {context}
                <input type="hidden" name="userId" value={editing.id} />
                <div className="field">
                  <label htmlFor="edit-publisher">{t("colPublisher")}</label>
                  <select
                    id="edit-publisher"
                    name="publisherId"
                    defaultValue={editing.publisher?.id ?? ""}
                  >
                    <option value="">{t("publisherNone")}</option>
                    {publishers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <span className="hint">{t("publisherHint")}</span>
                </div>
                <SubmitButton
                  className="btn"
                  label={t("savePublisher")}
                  pendingLabel={t("saving")}
                />
              </form>
            </div>
          )}
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <h2>{t("listHeading")}</h2>
          <span className="muted small">{t("resultCount", { count: total })}</span>
        </div>

        {users.length === 0 ? (
          <p className="muted">{t("noResults")}</p>
        ) : (
          <div className="table-wrap responsive" style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("colName")}</th>
                  <th>{t("colRole")}</th>
                  <th>{t("colOrg")}</th>
                  <th>{t("colPublisher")}</th>
                  <th>{t("colStatus")}</th>
                  <th>{t("colLastSignIn")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const deactivated = Boolean(u.deactivatedAt);
                  return (
                    <tr key={u.id}>
                      <td>
                        <div>{u.name || "—"}</div>
                        <div className="muted small">
                          <SafeEmail address={u.email} />
                        </div>
                      </td>
                      <td>{u.role}</td>
                      <td>{u.organization?.name ?? "—"}</td>
                      <td>{u.publisher?.name ?? "—"}</td>
                      <td>
                        <span
                          className={deactivated ? "badge-muted" : "badge-active"}
                        >
                          {deactivated ? t("statusDeactivated") : t("statusActive")}
                        </span>
                        {!u.emailVerifiedAt ? (
                          <div className="muted small">{t("statusUnverified")}</div>
                        ) : null}
                      </td>
                      <td className="muted small">
                        {u.lastSignInAt
                          ? u.lastSignInAt.toISOString().slice(0, 10)
                          : "—"}
                      </td>
                      <td>
                        <div
                          style={{
                            display: "flex",
                            gap: "0.5rem",
                            flexWrap: "wrap",
                            alignItems: "center",
                          }}
                        >
                          <Link href={listHref({ edit: u.id })}>{t("edit")}</Link>
                          {u.id === actorId ? null : (
                            <form action={setUserDeactivated}>
                              {context}
                              <input type="hidden" name="userId" value={u.id} />
                              <input
                                type="hidden"
                                name="deactivate"
                                value={deactivated ? "0" : "1"}
                              />
                              <SubmitButton
                                className={
                                  deactivated ? "btn small" : "btn small danger"
                                }
                                label={
                                  deactivated ? t("reactivate") : t("deactivate")
                                }
                                pendingLabel={t("saving")}
                              />
                            </form>
                          )}
                          {deactivated ? null : (
                            <>
                              <form action={sendUserPasswordReset}>
                                {context}
                                <input type="hidden" name="userId" value={u.id} />
                                <SubmitButton
                                  className="btn small secondary"
                                  label={t("sendReset")}
                                  pendingLabel={t("saving")}
                                />
                              </form>
                              <form action={sendUserSignInLink}>
                                {context}
                                <input type="hidden" name="userId" value={u.id} />
                                <SubmitButton
                                  className="btn small secondary"
                                  label={t("sendLink")}
                                  pendingLabel={t("saving")}
                                />
                              </form>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 ? (
          <nav className="pagination" style={{ marginTop: "1rem" }}>
            {page > 1 ? (
              <Link href={listHref({ page: String(page - 1), edit: "" })}>
                ← {t("prev")}
              </Link>
            ) : null}
            <span className="muted small">
              {t("pageOf", { page, pages: pageCount })}
            </span>
            {page < pageCount ? (
              <Link href={listHref({ page: String(page + 1), edit: "" })}>
                {t("next")} →
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </>
  );
}
