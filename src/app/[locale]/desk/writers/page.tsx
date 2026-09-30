import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadRoster } from "@/lib/writers/roster";
import { writerClaimPath } from "@/lib/writers/invite";
import { appUrl } from "@/lib/url";
import { intlLocale } from "@/lib/money";
import { SubmitButton } from "@/components";
import { resendWriterInvite } from "@/app/writer-invite-actions";
import { SafeEmail } from "@/components/safe-email";
import { InviteWriterForm } from "./invite-writer-form";

export const dynamic = "force-dynamic";

export default async function DeskWriters({
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

  const t = await getTranslations({ locale, namespace: "deskWriters" });
  const tEnum = await getTranslations({ locale, namespace: "writerEnums" });
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" });
  const origin = appUrl().replace(/\/+$/, "");

  const [roster, pendingInvites] = await Promise.all([
    loadRoster(),
    prisma.writerInvite.findMany({
      where: { claimedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>

      <section className="section">
        <div className="section-head">
          <h2>{t("inviteHeading")}</h2>
        </div>
        <InviteWriterForm locale={locale} />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t("pendingHeading")}</h2>
        </div>
        {pendingInvites.length === 0 ? (
          <p className="muted">{t("noPending")}</p>
        ) : (
          <div className="table-wrap responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("colEmail")}</th>
                  <th>{t("colLanguage")}</th>
                  <th>{t("colDelivery")}</th>
                  <th>{t("expires")}</th>
                  <th>{t("claimLink")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendingInvites.map((invite) => (
                  <tr key={invite.id}>
                    <td data-label={t("colEmail")}>
                      <SafeEmail address={invite.email} />
                    </td>
                    <td data-label={t("colLanguage")}>{t(`inviteLanguage.${invite.locale}`)}</td>
                    <td data-label={t("colDelivery")}>
                      {invite.emailedAt ? (
                        <span className="badge badge-success dotless">
                          {t("emailedOn", { date: dateFmt.format(invite.emailedAt) })}
                        </span>
                      ) : (
                        <span className="badge badge-warning dotless">{t("notEmailed")}</span>
                      )}
                    </td>
                    <td className="muted small" data-label={t("expires")}>
                      {dateFmt.format(invite.expiresAt)}
                    </td>
                    <td data-label={t("claimLink")}>
                      {/* Absolute and selectable, so the desk can still share
                          it by hand if the email bounced. */}
                      <input
                        readOnly
                        aria-label={t("claimLink")}
                        value={`${origin}${writerClaimPath(invite.locale, invite.token)}`}
                        className="small"
                        style={{ width: "100%", minWidth: 220 }}
                      />
                    </td>
                    <td className="actions-col">
                      <form action={resendWriterInvite}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="inviteId" value={invite.id} />
                        <SubmitButton
                          label={t("resend")}
                          pendingLabel={t("inviting")}
                          className="btn small ghost"
                        />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t("rosterHeading")}</h2>
          <span className="muted small">{roster.length}</span>
        </div>
        {roster.length === 0 ? (
          <p className="muted">{t("noWriters")}</p>
        ) : (
          <div className="table-wrap responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("colName")}</th>
                  <th>{t("colLanguages")}</th>
                  <th>{t("colSpecialties")}</th>
                  <th>{t("colStatus")}</th>
                  <th>{t("colLoad")}</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((w) => (
                  <tr key={w.id}>
                    <td data-label={t("colName")}>
                      {w.name ?? <SafeEmail address={w.email} />}
                    </td>
                    <td data-label={t("colLanguages")}>
                      {w.languages.length > 0
                        ? w.languages
                            .map((l) =>
                              l.proficiency
                                ? `${tEnum(`language.${l.language}`)} (${tEnum(`proficiency.${l.proficiency}`)})`
                                : tEnum(`language.${l.language}`),
                            )
                            .join(", ")
                        : <span className="muted">—</span>}
                    </td>
                    <td data-label={t("colSpecialties")}>
                      {w.specialties.length > 0
                        ? w.specialties.map((s) => tEnum(`topic.${s.topic}`)).join(", ")
                        : <span className="muted">—</span>}
                    </td>
                    <td data-label={t("colStatus")}>
                      <span className={w.active ? "badge badge-success" : "badge badge-neutral"}>
                        {w.active ? t("active") : t("inactive")}
                      </span>
                    </td>
                    <td className="num" data-label={t("colLoad")}>
                      {w.maxActiveAssignments != null
                        ? t("assignmentsOf", {
                            active: w.activeAssignments,
                            max: w.maxActiveAssignments,
                          })
                        : t("assignments", { active: w.activeAssignments })}
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
