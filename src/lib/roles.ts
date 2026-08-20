// Both functions below take a bare `string` rather than the stricter
// `UserRole` (see src/types/next-auth.d.ts, which IS UserRole-typed end to
// end) on purpose: they sit at a trust boundary — session/JWT data that
// predates a migration, or a garbage value — and are tested against exactly
// that kind of input. Narrowing the parameter would make the boundary
// untestable without also weakening it.

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
// helper instead of an inline `session?.user?.role === "SUPERADMIN"` check,
// so an inverted comparison at the call site would fail its own test.
export function canSeeCostVsSell(role: string | undefined | null): boolean {
  return role === "SUPERADMIN";
}
