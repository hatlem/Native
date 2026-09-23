"use server";

import { AuthError } from "next-auth";
import { cookies } from "next/headers";
import { after } from "next/server";
import bcrypt from "bcryptjs";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { landingForRole } from "@/lib/roles";
import { authLimiter } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { generateToken, hashToken, tokenExpiry } from "@/lib/tokens";
import { emailAdapter } from "@/lib/notify";
import { magicLinkEmail } from "@/lib/mail/templates/magic-link";
import { recordSignIn } from "@/lib/auth-events";
import { appUrl, appName } from "@/lib/url";
import { clientIp } from "@/lib/client-ip";
import { PLAN_COOKIE, PLAN_BRIEF_COOKIE } from "@/lib/basket";
import { CLIENT_COOKIE } from "@/lib/workspace";

// Returns the destination instead of calling next/navigation's redirect().
// The signin page's forms are client wrappers that navigate via
// `window.location.href` on the result — Next's own client-side transition
// to a *different* route after a server action is the same "router state
// header could not be parsed" failure mode as the same-route case documented
// in programme-actions.ts / CatalogSort.tsx, and was hanging real sign-ins
// on /check-email. A full navigation sidesteps it entirely.
export async function authenticate(formData: FormData): Promise<{ redirectTo: string }> {
  const locale = String(formData.get("locale") || "en");
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim();
  const password = String(formData.get("password") || "");

  // Rate-limit on the email AND the source IP — the attacker controls both
  // independently so we want either to slow them down.
  const ip = await clientIp();
  const [ipCheck, emailCheck] = await Promise.all([
    authLimiter.check(`signin:ip:${ip}`),
    authLimiter.check(`signin:email:${email}`),
  ]);
  const emailParam = email ? `&email=${encodeURIComponent(email)}` : "";
  if (!ipCheck.ok || !emailCheck.ok) {
    return { redirectTo: `/${locale}/signin?error=rate${emailParam}` };
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      // Disambiguate the "valid password, just unverified" case from
      // truly-wrong credentials. Telling that user "Invalid email or
      // password" sends them to forgot-password when the real fix is
      // to click a link in their inbox. Gated on a successful bcrypt
      // compare so we don't leak existence to anyone with a guess.
      const u = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          passwordHash: true,
          emailVerifiedAt: true,
          deactivatedAt: true,
        },
      });
      // Deactivated account, correct password: "Invalid email or password"
      // would send this user round the password-reset loop forever (the reset
      // succeeds, the sign-in still fails). Same enumeration trade-off as the
      // unverified branch below — gated on a successful bcrypt compare, so a
      // guesser learns nothing.
      if (u?.passwordHash && u.deactivatedAt) {
        const ok = await bcrypt.compare(password, u.passwordHash);
        if (ok) {
          await recordAudit(u.id, "auth.signin_deactivated", `User:${email}`, { ip });
          return { redirectTo: `/${locale}/signin?error=deactivated${emailParam}` };
        }
      }
      if (u?.passwordHash && !u.emailVerifiedAt) {
        const ok = await bcrypt.compare(password, u.passwordHash);
        if (ok) {
          const raw = generateToken();
          await prisma.magicLinkToken.create({
            data: {
              userId: u.id,
              tokenHash: hashToken(raw),
              expiresAt: tokenExpiry(),
              requestedIp: ip,
            },
          });
          const url = `${appUrl()}/${locale}/magic-link/${raw}`;
          const msg = magicLinkEmail({ url, locale, appName: appName() });
          const unverifiedUserId = u.id;
          after(async () => {
            try {
              await emailAdapter({ to: email, subject: msg.subject, text: msg.text, html: msg.html });
            } catch (err) {
              console.error("auth.verify_email_resend_failed", { userId: unverifiedUserId, err });
            }
            await recordAudit(unverifiedUserId, "auth.verify_email_resent", `User:${email}`, { ip });
          });
          return { redirectTo: `/${locale}/check-email?verify=1` };
        }
      }
      await recordAudit(email || "anonymous", "auth.signin_failed", `User:${email}`, { ip });
      return { redirectTo: `/${locale}/signin?error=1${emailParam}` };
    }
    throw error;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });
  await recordAudit(user?.id ?? email, "auth.signin", `User:${email}`, { ip });
  if (user?.id) {
    await recordSignIn({
      userId: user.id,
      userEmail: email,
      ip,
      locale,
      appName: appName(),
      resetUrl: `${appUrl()}/${locale}/forgot-password`,
    });
  }
  return { redirectTo: landingForRole(user?.role, locale) };
}

// Magic-link sign-in: user submits email, we email them a one-tap link.
// We always redirect to /check-email, regardless of whether the email
// matched a real account, to avoid account enumeration.
export async function requestMagicLink(formData: FormData): Promise<{ redirectTo: string }> {
  const locale = String(formData.get("locale") || "en");
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim();

  const ip = await clientIp();
  const [ipCheck, emailCheck] = await Promise.all([
    authLimiter.check(`magic-link:ip:${ip}`),
    authLimiter.check(`magic-link:email:${email}`),
  ]);
  if (!ipCheck.ok || !emailCheck.ok) {
    return { redirectTo: `/${locale}/signin?error=rate` };
  }

  if (!email) {
    return { redirectTo: `/${locale}/check-email` };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });

  if (user) {
    // Token row MUST exist before the email leaves — otherwise a fast
    // recipient could click the link before the row is committed.
    const raw = generateToken();
    await prisma.magicLinkToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: tokenExpiry(),
        requestedIp: ip,
      },
    });
    // Hand the email send + audit write to `next/server`'s `after()` so
    // they run AFTER the response is committed. This closes most of the
    // timing-attack window between the user-exists branch (SMTP latency,
    // ~10²ms) and the unknown-email branch (audit only, ~10ms). Both
    // branches return the same /check-email redirect on the same code
    // path — the post-response work is invisible to the attacker.
    const url = `${appUrl()}/${locale}/magic-link/${raw}`;
    const msg = magicLinkEmail({ url, locale, appName: appName() });
    const userId = user.id;
    const userEmail = user.email;
    after(async () => {
      try {
        await emailAdapter({ to: userEmail, subject: msg.subject, text: msg.text, html: msg.html });
      } catch (err) {
        console.error("auth.magic_link_email_failed", { userId, err });
      }
      await recordAudit(userId, "auth.magic_link_requested", `User:${userEmail}`, { ip });
    });
  } else {
    // Same shape: audit also deferred so timing parity holds.
    after(async () => {
      await recordAudit(email, "auth.magic_link_requested_unknown", `User:${email}`, { ip });
    });
  }

  return { redirectTo: `/${locale}/check-email` };
}

export async function logout(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  // Clear the basket/brief cookies so the next user on this browser
  // doesn't inherit the previous session's plan basket. The cookies
  // are not user-scoped (they predate auth), so we treat sign-out as
  // the natural "abandon plan" boundary. Found via scenario testing:
  // a fresh-signup buyer landed on /plan with the prior user's lines
  // already selected.
  const store = await cookies();
  store.delete(PLAN_COOKIE);
  store.delete("nativespin_active_list");
  store.delete(PLAN_BRIEF_COOKIE);
  // Also drop the agency client-switch cookie so a logout doesn't
  // leave the next user with someone else's client context.
  store.delete(CLIENT_COOKIE);
  await signOut({ redirectTo: `/${locale}` });
}
