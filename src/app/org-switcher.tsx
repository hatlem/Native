import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import type { Workspace } from "@/lib/workspace";
import { switchOrg } from "@/app/org-switch-actions";

export type SwitchableOrg = { id: string; name: string };

/** The orgs a multi-org user can switch between, or null: a single-org user
 *  and an agency (whose client switcher lives on /agency) have none. Loaded
 *  once per layout render and shared by the switcher and the header's
 *  active-org label. */
export async function switchableOrgs(workspace: Workspace | null): Promise<SwitchableOrg[] | null> {
  if (!workspace || workspace.isAgency || workspace.scopeOrgIds.length < 2) return null;
  const orgs = await prisma.organization.findMany({
    where: { id: { in: workspace.scopeOrgIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return orgs.length < 2 ? null : orgs;
}

// Org switcher for someone with seats in more than one org (e.g. invited into
// a second company). Rendered inside the user menu and the mobile drawer.
// Renders nothing for a single-org user and for agencies, whose client
// switcher lives on /agency. The current org is marked, not a button.
export async function OrgSwitcher({
  locale,
  workspace,
  orgs,
}: {
  locale: string;
  workspace: Workspace | null;
  // From switchableOrgs(): null when there is nothing to switch between.
  orgs: SwitchableOrg[] | null;
}) {
  if (!workspace || !orgs) return null;
  const t = await getTranslations({ locale, namespace: "nav" });

  return (
    <div className="org-switcher" role="group" aria-label={t("orgSwitcherLabel")}>
      <div className="org-switcher__label">{t("orgSwitcherLabel")}</div>
      {orgs.map((org) =>
        org.id === workspace.activeOrgId ? (
          <div key={org.id} className="menu-item org-switcher__current" aria-current="true">
            <span aria-hidden="true">✓</span>
            {org.name}
          </div>
        ) : (
          <form key={org.id} action={switchOrg}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="organizationId" value={org.id} />
            <button type="submit" className="menu-item" aria-label={t("orgSwitchTo", { org: org.name })}>
              <span aria-hidden="true" className="org-switcher__spacer" />
              {org.name}
            </button>
          </form>
        ),
      )}
    </div>
  );
}
