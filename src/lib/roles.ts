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
