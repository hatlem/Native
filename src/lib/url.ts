// Origin for building absolute links in emails / redirects. Verbatim move
// of the helper currently duplicated in auth-actions.ts and the magic-link
// route — same env precedence, same fallback, no behavior change.
// Synchronous and dependency-free.
export function appUrl(): string {
  return (
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000"
  );
}
