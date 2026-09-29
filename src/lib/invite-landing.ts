// Where a buyer lands after claiming an org invite. Someone invited into an
// organisation is almost always there to look at that team's plans, so they
// land on the saved lists when the org has any — the account/team settings
// page (the old destination) is an admin screen, not a welcome. With no plans
// yet they get the buyer home, same as a normal sign-in (landingForRole).
// `joined=1` shows the one-time welcome notice on either page.
export function inviteLandingPath(locale: string, activePlanCount: number): string {
  return activePlanCount > 0 ? `/${locale}/lists?joined=1` : `/${locale}/home?joined=1`;
}
