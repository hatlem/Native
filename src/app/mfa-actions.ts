"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { recordSignIn } from "@/lib/auth-events";
import { landingForRole } from "@/lib/roles";
import { safeNext } from "@/lib/auth-gate";
import { clientIp } from "@/lib/client-ip";
import { appUrl, appName } from "@/lib/url";
import {
  cancelEnrolment,
  confirmEnrolment,
  disableMfa,
  regenerateRecoveryCodes,
  startEnrolment,
  verifySecondFactor,
} from "@/lib/mfa/store";
import { MFA_CODES_COOKIE, codesCookieOptions, sealRecoveryCodes } from "@/lib/mfa/tickets";
import { issueSession } from "@/lib/mfa/session";
import {
  clearPendingMfa,
  currentPendingMfa,
  mfaHourlyLimiter,
  mfaLimiter,
  mfaManageLimiter,
  mfaStepPath,
} from "@/lib/mfa/signin";

// ── Sign-in, second step ───────────────────────────────────────────────────
// Returns the destination (the form navigates with window.location, same as
// the first step — see auth-actions.ts for why).
export async function completeMfaSignIn(formData: FormData): Promise<{ redirectTo: string }> {
  const locale = String(formData.get("locale") || "en");
  const code = String(formData.get("code") || "").trim();
  const ip = await clientIp();

  const pending = await currentPendingMfa();
  if (!pending) return { redirectTo: `/${locale}/signin?error=mfa_expired` };

  const [userCheck, ipCheck, hourCheck] = await Promise.all([
    mfaLimiter.check(`mfa:user:${pending.uid}`),
    mfaLimiter.check(`mfa:ip:${ip}`),
    mfaHourlyLimiter.check(`mfa:user:${pending.uid}`),
  ]);
  if (!userCheck.ok || !ipCheck.ok || !hourCheck.ok) {
    await recordAudit(pending.uid, "auth.mfa_rate_limited", `User:${pending.uid}`, { ip });
    return { redirectTo: `${mfaStepPath(locale)}?error=rate` };
  }

  const user = await prisma.user.findUnique({
    where: { id: pending.uid },
    select: { id: true, email: true, role: true, deactivatedAt: true, sessionVersion: true },
  });
  if (!user || user.deactivatedAt) {
    await clearPendingMfa();
    return { redirectTo: `/${locale}/signin?error=1` };
  }

  const result = await verifySecondFactor(user.id, code);
  if (!result.ok) {
    await recordAudit(user.id, "auth.mfa_failed", `User:${user.email}`, { ip, reason: result.reason });
    if (result.reason === "not_enabled") {
      // Two-factor was switched off between the two steps (break-glass
      // reset): the pending cookie no longer means anything. Start over.
      await clearPendingMfa();
      return { redirectTo: `/${locale}/signin` };
    }
    return { redirectTo: `${mfaStepPath(locale)}?error=${result.reason === "replay" ? "replay" : "1"}` };
  }

  const issued = await issueSession(user.id, user.sessionVersion);
  await clearPendingMfa();
  if (!issued) return { redirectTo: `/${locale}/signin?error=1` };

  await recordAudit(user.id, "auth.mfa_verified", `User:${user.email}`, {
    ip,
    method: result.method,
    via: pending.via,
    recoveryCodesLeft: result.recoveryCodesLeft,
  });
  await recordAudit(user.id, "auth.signin", `User:${user.email}`, { ip, mfa: true });
  await recordSignIn({
    userId: user.id,
    userEmail: user.email,
    ip,
    locale,
    appName: appName(),
    resetUrl: `${appUrl()}/${locale}/forgot-password`,
  });

  // Signed in with a recovery code: land on the security page so they see how
  // many are left (and can re-enrol a new phone) instead of finding out at 0.
  if (result.method === "recovery") {
    return { redirectTo: `/${locale}/account/security?notice=recovery_used` };
  }
  return { redirectTo: safeNext(pending.next, "") || landingForRole(user.role, locale) };
}

export async function cancelMfaSignIn(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  await clearPendingMfa();
  redirect(`/${locale}/signin`);
}

// ── Enrolment (signed-in, /account/security) ───────────────────────────────

async function requireUser(locale: string) {
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);
  return session.user;
}

export async function startMfaEnrolment(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const me = await requireUser(locale);
  const secret = await startEnrolment(me.id);
  if (secret) await recordAudit(me.id, "auth.mfa_enrol_started", `User:${me.id}`);
  redirect(`/${locale}/account/security`);
}

export async function cancelMfaEnrolment(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const me = await requireUser(locale);
  await cancelEnrolment(me.id);
  redirect(`/${locale}/account/security`);
}

export type MfaFormState = {
  error?: "invalid" | "rate" | "password";
};

// Hand freshly generated recovery codes to the "save these" screen: sealed in
// a short-lived httpOnly cookie (see tickets.ts), then a redirect so the page
// renders on a request that already carries the re-minted session.
async function showRecoveryCodes(
  userId: string,
  codes: string[],
  locale: string,
  justEnrolled = false,
): Promise<never> {
  const store = await cookies();
  store.set(MFA_CODES_COOKIE, sealRecoveryCodes(userId, codes), codesCookieOptions());
  redirect(`/${locale}/account/security?codes=${justEnrolled ? "enrolled" : "new"}`);
}

// "I've saved them": forget the codes cookie and move on.
export async function dismissRecoveryCodes(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const next = safeNext(String(formData.get("next") || ""), "");
  const store = await cookies();
  store.delete(MFA_CODES_COOKIE);
  redirect(next || `/${locale}/account/security`);
}

export async function confirmMfaEnrolment(
  _prev: MfaFormState,
  formData: FormData,
): Promise<MfaFormState> {
  const locale = String(formData.get("locale") || "en");
  const me = await requireUser(locale);
  const code = String(formData.get("code") || "");

  const limit = await mfaManageLimiter.check(`mfa:manage:${me.id}`);
  if (!limit.ok) return { error: "rate" };

  const result = await confirmEnrolment(me.id, code);
  if (!result.ok) {
    await recordAudit(me.id, "auth.mfa_enrol_failed", `User:${me.id}`);
    return { error: "invalid" };
  }
  await recordAudit(me.id, "auth.mfa_enabled", `User:${me.id}`, { ip: await clientIp() });
  // Enabling bumped the session version (every older session ends); keep
  // this browser signed in under the new one.
  await issueSession(me.id, result.sessionVersion);
  return showRecoveryCodes(me.id, result.recoveryCodes, locale, true);
}

// A password (when the account has one) or a current code / recovery code.
async function proveFactor(userId: string, formData: FormData): Promise<MfaFormState["error"] | null> {
  const limit = await mfaManageLimiter.check(`mfa:manage:${userId}`);
  if (!limit.ok) return "rate";
  const password = String(formData.get("password") || "");
  const code = String(formData.get("code") || "").trim();
  if (password) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (u?.passwordHash && (await bcrypt.compare(password, u.passwordHash))) return null;
    return "password";
  }
  if (code) {
    const r = await verifySecondFactor(userId, code);
    return r.ok ? null : "invalid";
  }
  return "invalid";
}

export async function regenerateMfaRecoveryCodes(
  _prev: MfaFormState,
  formData: FormData,
): Promise<MfaFormState> {
  const locale = String(formData.get("locale") || "en");
  const me = await requireUser(locale);
  const failed = await proveFactor(me.id, formData);
  if (failed) {
    await recordAudit(me.id, "auth.mfa_failed", `User:${me.id}`, { at: "recovery_regenerate" });
    return { error: failed };
  }
  const codes = await regenerateRecoveryCodes(me.id);
  if (!codes) return { error: "invalid" };
  await recordAudit(me.id, "auth.mfa_recovery_regenerated", `User:${me.id}`);
  return showRecoveryCodes(me.id, codes, locale);
}

export async function disableMfaAction(
  _prev: MfaFormState,
  formData: FormData,
): Promise<MfaFormState> {
  const locale = String(formData.get("locale") || "en");
  const me = await requireUser(locale);
  const failed = await proveFactor(me.id, formData);
  if (failed) {
    await recordAudit(me.id, "auth.mfa_failed", `User:${me.id}`, { at: "disable" });
    return { error: failed };
  }
  const sessionVersion = await disableMfa(me.id);
  if (sessionVersion === null) redirect(`/${locale}/account/security`);
  await recordAudit(me.id, "auth.mfa_disabled", `User:${me.id}`, { ip: await clientIp() });
  await issueSession(me.id, sessionVersion);
  redirect(`/${locale}/account/security?notice=disabled`);
}
