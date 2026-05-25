// Where each role lands after authentication. Buyers (and any org-side
// account) go to the catalog; desk/admin to the console; publishers to
// their portal.
export function landingForRole(
  role: string | undefined,
  locale: string,
): string {
  switch (role) {
    case "PUBLISHER":
      return `/${locale}/publisher`;
    case "DESK":
    case "SUPERADMIN":
    case "CONTENT":
      // Writers land on the desk console — same surface, narrower
      // action gating (see desk-actions.requireDeskOrContent).
      return `/${locale}/desk`;
    default:
      return `/${locale}/catalog`;
  }
}
