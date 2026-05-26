// Magic-link consume endpoint. A Route Handler (not a Page) because
// `signIn` needs to set the session cookie — which Server Components
// can't do during render. Route handlers can.
//
// The "magic-link" Credentials provider in `src/auth.ts` performs the
// atomic single-use consume + emailVerifiedAt update inside its
// `authorize` callback. This handler:
//   1. Resolves the userId/role BEFORE signIn so we know where to land
//      the user — and so we can fire the new-sign-in IP-change alert.
//   2. Calls signIn with redirectTo set to the role-appropriate landing.
//      signIn throws NEXT_REDIRECT on success; we re-throw to let Next
//      handle the response (cookies set, 307 to landing).
//   3. On any signIn failure (token invalid/used/expired/rate-limited),
//      redirect to /signin?error=magic_expired so the inline banner
//      shows up on the next page.

import { type NextRequest, NextResponse } from "next/server";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/tokens";
import { landingForRole } from "@/lib/roles";
import { recordSignIn } from "@/lib/auth-events";
import { recordAudit } from "@/lib/audit";

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function appUrl(): string {
  return (
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000"
  );
}

function appName(): string {
  return process.env.AUTH_APP_NAME ?? "ATNative";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ locale: string; token: string }> },
) {
  const { locale, token } = await params;
  const ip = clientIp(req);

  // Resolve the user BEFORE signIn so we know the landing URL and the
  // identity for the audit/alert. Reading the row by hash is safe even
  // before the consume because:
  //  - if the token isn't there, signIn will fail anyway, so we redirect
  //    to the error page below
  //  - if it IS there, we know who's about to be signed in
  const row = await prisma.magicLinkToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      consumedAt: true,
      expiresAt: true,
      user: { select: { id: true, email: true, role: true } },
    },
  });

  // Pre-flight: surface the same "expired/used" outcome as a redirect
  // instead of letting signIn do it — saves one bounce.
  if (!row || row.consumedAt || row.expiresAt.getTime() <= Date.now()) {
    await recordAudit("anonymous", "auth.magic_link_invalid", "Token", {
      ip,
      reason: !row ? "not_found" : row.consumedAt ? "consumed" : "expired",
    });
    return NextResponse.redirect(
      new URL(`/${locale}/signin?error=magic_expired`, req.url),
    );
  }

  const landing = landingForRole(row.user.role, locale);

  // signIn with redirectTo: on success it throws NEXT_REDIRECT (which we
  // re-throw so Next.js serves the 307 with the session cookie set).
  // On failure the provider returned null — signIn throws AuthError; we
  // catch and redirect to the error banner.
  try {
    await signIn("magic-link", { token, redirectTo: landing });
  } catch (e) {
    if (isRedirectError(e)) {
      // Success path: signIn issued the cookie + queued the redirect.
      // Record audit + fire new-IP alert AFTER scheduling the redirect
      // — fire-and-forget; the response is already on its way.
      // (recordAudit/recordSignIn are best-effort and log on failure.)
      void recordAudit(row.user.id, "auth.magic_link_consumed", `User:${row.user.email}`, { ip });
      void recordSignIn({
        userId: row.user.id,
        userEmail: row.user.email,
        ip,
        locale,
        appName: appName(),
        resetUrl: `${appUrl()}/${locale}/forgot-password`,
      });
      throw e;
    }
    // Anything else = real failure (rate-limited consume, race lost, etc).
    await recordAudit("anonymous", "auth.magic_link_invalid", "Token", { ip, reason: "signin_failed" });
    return NextResponse.redirect(
      new URL(`/${locale}/signin?error=magic_expired`, req.url),
    );
  }

  // Unreachable: signIn always throws (NEXT_REDIRECT on success).
  return NextResponse.redirect(new URL(landing, req.url));
}
