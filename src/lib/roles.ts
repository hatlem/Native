// Where each role lands after authentication. Buyers (and any org-side
// account) go to Home; desk/admin to the console; publishers to their
// portal.
export function landingForRole(
  role: string | undefined,
  locale: string,
): string {
  switch (role) {
    case "PUBLISHER":
      return `/${locale}/publisher`;
    case "CONTENT":
      // Writers get a focused console scoped to their assigned lines.
      return `/${locale}/writer`;
    case "DESK":
    case "SUPERADMIN":
      return `/${locale}/desk`;
    default:
      return `/${locale}/home`;
  }
}

// Cost-vs-sell (unitCost/margin) is publisher-sensitive commercial data —
// gated to SUPERADMIN only, everywhere it's shown (currently
// desk/[requestId]/page.tsx). A named, exported, independently-tested
// helper instead of an inline `session?.user?.role === "SUPERADMIN"` check:
// `role` is typed as a loose `string` on the session (see
// src/types/next-auth.d.ts), so a typo or an inverted comparison at the
// call site would silently compile — this function is the one place that
// needs to get the comparison right, and the one place tested for it.
export function canSeeCostVsSell(role: string | undefined | null): boolean {
  return role === "SUPERADMIN";
}
