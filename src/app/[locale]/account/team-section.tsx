import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { isMembershipActive } from "@/lib/membership";
import { SubmitButton } from "@/components";
import {
  inviteToOrg,
  revokeMembership,
  revokeInvite,
} from "@/app/org-invite-actions";

type Props = {
  locale: string;
  orgId: string;
  isAdmin: boolean;
};

export async function TeamSection({ locale, orgId, isAdmin }: Props) {
  const t = await getTranslations({ locale, namespace: "account" });

  const [members, pendingInvites] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId: orgId },
      select: {
        userId: true,
        organizationId: true,
        role: true,
        canCommit: true,
        expiresAt: true,
        status: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    isAdmin
      ? prisma.orgInvite.findMany({
          where: { organizationId: orgId, claimedAt: null },
          select: {
            id: true,
            email: true,
            role: true,
            canCommit: true,
            expiresAt: true,
            delegationExpiresAt: true,
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const now = new Date();

  return (
    <section className="section" id="team">
      <div className="section-head">
        <div>
          <span className="eyebrow">{t("teamEyebrow")}</span>
          <h2>{t("teamTitle")}</h2>
        </div>
      </div>

      {/* Members table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("colName")}</th>
              <th>{t("colEmail")}</th>
              <th>{t("colRole")}</th>
              <th>{t("colCommit")}</th>
              <th>{t("colStatus")}</th>
              <th>{t("colExpires")}</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const active = isMembershipActive(
                {
                  userId: m.userId,
                  organizationId: m.organizationId,
                  role: m.role as import("@/lib/membership").MembershipRole,
                  canCommit: m.canCommit,
                  expiresAt: m.expiresAt,
                  status: m.status as import("@/lib/membership").MembershipStatus,
                },
                now,
              );
              const expires = m.expiresAt
                ? m.expiresAt.toISOString().slice(0, 10)
                : null;
              const roleLabel =
                m.role === "ADMIN"
                  ? t("roleAdmin")
                  : m.role === "MEMBER"
                    ? t("roleMember")
                    : t("roleRestricted");
              return (
                <tr key={m.userId}>
                  <td>{m.user?.name ?? "—"}</td>
                  <td>{m.user?.email ?? "—"}</td>
                  <td>{roleLabel}</td>
                  <td>{m.canCommit ? t("yes") : t("no")}</td>
                  <td>
                    <span className={active ? "badge-active" : "badge-muted"}>
                      {active ? t("statusActive") : t("statusExpired")}
                    </span>
                  </td>
                  <td>{expires ?? "—"}</td>
                  {isAdmin && (
                    <td>
                      <form action={revokeMembership}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="userId" value={m.userId} />
                        <SubmitButton
                          label={t("revoke")}
                          pendingLabel={t("saving")}
                        />
                      </form>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Invite form — admin only */}
      {isAdmin && (
        <>
          <div className="section-head" style={{ marginTop: "2rem" }}>
            <div>
              <h3>{t("inviteHeading")}</h3>
            </div>
          </div>
          <form action={inviteToOrg} className="product-form card">
            <input type="hidden" name="locale" value={locale} />
            <div className="field">
              <label htmlFor="team-email">{t("colEmail")}</label>
              <input
                id="team-email"
                name="email"
                type="email"
                required
                placeholder={t("emailPlaceholder")}
              />
            </div>
            <div className="field">
              <label htmlFor="team-role">{t("colRole")}</label>
              <select id="team-role" name="role" defaultValue="MEMBER">
                <option value="ADMIN">{t("roleAdmin")}</option>
                <option value="MEMBER">{t("roleMember")}</option>
                <option value="RESTRICTED">{t("roleRestricted")}</option>
              </select>
            </div>
            <div className="field">
              <label className="checkbox-label">
                <input type="checkbox" name="canCommit" />
                {t("canCommitLabel")}
              </label>
            </div>
            <div className="field">
              <label htmlFor="team-delegation">{t("delegationEndsLabel")}</label>
              <input
                id="team-delegation"
                name="delegationExpiresAt"
                type="date"
                min={now.toISOString().slice(0, 10)}
              />
            </div>
            <div className="actions">
              <SubmitButton label={t("sendInvite")} pendingLabel={t("saving")} />
            </div>
          </form>

          {/* Pending invites */}
          <div className="section-head" style={{ marginTop: "2rem" }}>
            <div>
              <h3>{t("pendingHeading")}</h3>
            </div>
          </div>
          {pendingInvites.length === 0 ? (
            <p className="muted small">{t("pendingNone")}</p>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("colEmail")}</th>
                    <th>{t("colRole")}</th>
                    <th>{t("colCommit")}</th>
                    <th>{t("colExpires")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pendingInvites.map((inv) => {
                    const roleLabel =
                      inv.role === "ADMIN"
                        ? t("roleAdmin")
                        : inv.role === "MEMBER"
                          ? t("roleMember")
                          : t("roleRestricted");
                    const expires = inv.expiresAt
                      ? inv.expiresAt.toISOString().slice(0, 10)
                      : null;
                    return (
                      <tr key={inv.id}>
                        <td>{inv.email}</td>
                        <td>{roleLabel}</td>
                        <td>{inv.canCommit ? t("yes") : t("no")}</td>
                        <td>{expires ?? "—"}</td>
                        <td>
                          <form action={revokeInvite}>
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="inviteId" value={inv.id} />
                            <SubmitButton
                              label={t("revoke")}
                              pendingLabel={t("saving")}
                            />
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
