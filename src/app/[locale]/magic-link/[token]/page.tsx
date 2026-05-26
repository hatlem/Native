import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";
import { landingForRole } from "@/lib/roles";
import { hashToken } from "@/lib/tokens";
import { recordSignIn } from "@/lib/auth-events";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
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

export default async function MagicLinkPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  const ip = await clientIp();

  // The Credentials provider performs the atomic consume. If it fails
  // (token invalid, already consumed, expired), signIn throws AuthError;
  // we catch and render the inline error state.
  let signedIn = false;
  try {
    await signIn("magic-link", { token, redirect: false });
    signedIn = true;
  } catch {
    signedIn = false;
  }

  if (!signedIn) {
    await recordAudit("anonymous", "auth.magic_link_invalid", "Token", { ip });
    return (
      <LandingShell locale={locale} screenLabel="Sign in">
        <section className="auth-shell">
          <div className="auth-card" style={{ maxWidth: 440 }}>
            <div className="head">
              <h2>{t("magicLinkExpired")}</h2>
            </div>
            <div className="alt">
              <Link href="/signin">{t("backToSignin")}</Link>
            </div>
          </div>
        </section>
      </LandingShell>
    );
  }

  // Look up the just-consumed token row to find the user. We don't rely
  // on `auth()` here because the freshly issued session cookie may not be
  // readable inside the same request via that helper. The token row's
  // userId is the source of truth for "who just signed in".
  const row = await prisma.magicLinkToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      userId: true,
      user: { select: { id: true, email: true, role: true } },
    },
  });
  if (!row?.user) {
    redirect(`/${locale}/signin`);
  }

  await recordAudit(row.user.id, "auth.magic_link_consumed", `User:${row.user.email}`, { ip });

  await recordSignIn({
    userId: row.user.id,
    userEmail: row.user.email,
    ip,
    locale,
    appName: appName(),
    resetUrl: `${appUrl()}/${locale}/forgot-password`,
  });

  redirect(landingForRole(row.user.role, locale));
}
