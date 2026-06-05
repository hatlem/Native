import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadRoster } from "@/lib/writers/roster";
import { SubmitButton } from "@/components";
import { createWriterInvite } from "@/app/writer-invite-actions";

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

      {/* Invite form */}
      <section className="section">
        <div className="section-head">
          <h2>{t("inviteHeading")}</h2>
        </div>
        <form action={createWriterInvite} className="card stack-4">
          <input type="hidden" name="locale" value={locale} />
          <label className="field">
            <span>{t("emailLabel")}</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="off"
              placeholder="writer@example.com"
            />
          </label>
          <SubmitButton
            className="btn primary"
            label={t("inviteButton")}
            pendingLabel={t("inviting")}
          />
        </form>
      </section>

      {/* Pending invites */}
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
                  <th>Email</th>
                  <th>{t("expires")}</th>
                  <th>{t("claimLink")}</th>
                </tr>
              </thead>
              <tbody>
                {pendingInvites.map((invite) => (
                  <tr key={invite.id}>
                    <td>{invite.email}</td>
                    <td className="muted small">
                      {invite.expiresAt.toLocaleDateString()}
                    </td>
                    <td>
                      <code className="small">
                        {`/${locale}/writer/claim/${invite.token}`}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Roster */}
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
                  <th>Name</th>
                  <th>Languages</th>
                  <th>Specialties</th>
                  <th>Status</th>
                  <th>Load</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((w) => (
                  <tr key={w.id}>
                    <td>{w.name ?? w.email}</td>
                    <td>
                      {w.languages.length > 0
                        ? w.languages
                            .map(
                              (l) =>
                                `${l.language}${l.proficiency ? ` (${l.proficiency})` : ""}`,
                            )
                            .join(", ")
                        : <span className="muted">—</span>}
                    </td>
                    <td>
                      {w.specialties.length > 0
                        ? w.specialties.map((s) => s.topic).join(", ")
                        : <span className="muted">—</span>}
                    </td>
                    <td>
                      <span className={w.active ? "badge green" : "badge muted"}>
                        {w.active ? t("active") : t("inactive")}
                      </span>
                    </td>
                    <td className="num">
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
