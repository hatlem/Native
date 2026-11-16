"use server";

import { isMfaRequiredError, reissueSessionFor } from "@/lib/mfa/session";
import { hashPassword } from "@/lib/password";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { MarketCode } from "@prisma/client";
import { AuthError } from "next-auth";
import { auth, signIn, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { deactivateUserUnlessLastAdmin } from "@/lib/org-seats";
import { anonymiseUser } from "@/lib/retention";
import { canDeactivateSelf } from "@/lib/user-admin";
import { companySeat, getWorkspace } from "@/lib/workspace";
import { normaliseEmail } from "@/lib/email-change";
import { SUPPORTED_MARKETS } from "@/lib/markets";
import { asNoticeLocale } from "@/lib/notices/messages";
import { accountFail, type AccountFormState } from "@/lib/account-form-state";

const MARKET_CODES: readonly string[] = SUPPORTED_MARKETS;

// Same lenient phone validator as onboarding — keep both in sync.
function normalisePhone(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}
function isValidPhone(raw: string): boolean {
  if (raw.length === 0) return true; // clearing phone is allowed
  const digits = raw.match(/\d/g)?.length ?? 0;
  return raw.length <= 32 && digits >= 6;
}

// updateProfile, setPassword and deactivateOwnAccount are useActionState
// actions: a validation failure RETURNS the error code and what was typed
// (never a password), so the form shows it next to the field and keeps the
// input. Success and "not signed in" still redirect.
export async function updateProfile(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const locale = String(formData.get("locale") || "en");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const name = String(formData.get("name") || "").trim();
  const phoneRaw = String(formData.get("phone") || "");
  const phone = normalisePhone(phoneRaw);

  if (!isValidPhone(phone)) {
    return accountFail("phone", { name, phone: phoneRaw });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      name: name || null,
      phone: phone || null,
    },
  });
  await recordAudit(session.user.id, "user.profile_updated", `User:${session.user.id}`, {
    fields: ["name", "phone"],
  });
  redirect(`/${locale}/account?ok=profile#profile`);
}

// Persist the language picked under Account → Language as the user's stored
// language (User.locale). The URL prefix and NEXT_LOCALE cookie only steer
// this browser; every email and notice addressed to the user renders in
// User.locale (lib/notify.ts), so without this write the switch would reach
// their inbox only after the next sign-in. Called by the client switcher
// before it re-navigates — it returns rather than redirects so the switcher
// keeps control of the navigation. An unknown locale is ignored.
export async function saveLanguagePreference(locale: string): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  const next = asNoticeLocale(locale);
  if (!next) return { ok: false };

  const res = await prisma.user.updateMany({
    // Only when it changes (NULL never equals, hence the explicit null arm),
    // so re-picking the current language writes no audit row.
    where: { id: session.user.id, OR: [{ locale: null }, { NOT: { locale: next } }] },
    data: { locale: next },
  });
  if (res.count > 0) {
    await recordAudit(session.user.id, "user.locale_updated", `User:${session.user.id}`, {
      locale: next,
    });
  }
  return { ok: true };
}

export async function updateCompany(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const orgName = String(formData.get("orgName") || "").trim();
  const market = String(formData.get("market") || "").trim();

  if (!orgName || !MARKET_CODES.includes(market)) {
    redirect(`/${locale}/account?error=company#company`);
  }

  // The company is the org the user is working in (lib/workspace companySeat)
  // — the same one /account shows — and only an ADMIN seat in it may edit.
  // Resolving it from the workspace rather than User.organizationId matters
  // twice over: a member of several orgs edits the org they switched to, and
  // a removed member (no workspace) edits nothing.
  const ws = await getWorkspace(session.user.id);
  const seat = ws ? companySeat(ws) : null;
  if (!seat?.orgId) {
    redirect(`/${locale}/account?error=no_org#company`);
  }
  if (!seat.isAdmin) {
    redirect(`/${locale}/account?error=forbidden#company`);
  }
  await prisma.organization.update({
    where: { id: seat.orgId },
    data: {
      name: orgName,
      marketCode: market as MarketCode,
    },
  });
  await recordAudit(session.user.id, "organization.updated", `Organization:${seat.orgId}`, {
    name: orgName,
    market,
  });
  redirect(`/${locale}/account?ok=company#company`);
}

// Set or change the user's password. If the user signed up via magic-
// link and has no password yet, currentPassword is not required. If a
// password already exists, we verify the current one before accepting
// the new one — same UX as resetPassword but in the signed-in flow.
export async function setPassword(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const locale = String(formData.get("locale") || "en");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const current = String(formData.get("currentPassword") || "");
  const next = String(formData.get("newPassword") || "");
  if (next.length < 8) {
    return accountFail("password_length");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true, email: true },
  });
  if (!user) redirect(`/${locale}/signin`);

  if (user.passwordHash) {
    // Existing-password users must prove they know it.
    const ok = await bcrypt.compare(current, user.passwordHash);
    if (!ok) {
      return accountFail("current_password");
    }
  }

  // Bumping the session version ends every other session on the account —
  // including a stolen one, which is usually why people change a password.
  // It ends this browser's session too, so re-mint it straight away with the
  // password the user just chose (see @/lib/session-version).
  const hash = await hashPassword(next);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hash, sessionVersion: { increment: 1 } },
  });
  await recordAudit(user.id, "user.password_set", `User:${user.id}`, {
    hadPasswordBefore: !!user.passwordHash,
  });
  try {
    await signIn("credentials", { email: user.email, password: next, redirect: false });
  } catch (error) {
    // Two-factor account: the credentials provider won't mint a session on a
    // password alone. This user is already fully signed in (and just proved
    // the old password), so re-mint through the ticket provider instead.
    if (isMfaRequiredError(error) && (await reissueSessionFor(user.id))) {
      redirect(`/${locale}/account?ok=password#password`);
    }
    // The change itself is saved; only the re-mint failed (e.g. the sign-in
    // limiter). Signing in again with the new password is the honest way on.
    if (error instanceof AuthError) redirect(`/${locale}/signin`);
    throw error;
  }
  redirect(`/${locale}/account?ok=password#password`);
}

// Self-service off-boarding. Deactivation, not deletion: orders, quotes and
// invoices this user signed are financial records the platform has to keep,
// and an anonymised-user cascade through those tables is a different (and
// much larger) piece of work than "let me out". What the user gets is the
// thing they actually asked for — the account stops working immediately, on
// every sign-in route — and it is reversible by a super-admin if they come
// back, which a delete would not be.
//
// Two guards stand between the button and the stamp, both of which exist to
// stop a single click stranding other people:
//   - the last active super-admin can't walk out (nobody left to let anyone
//     back in, including them)
//   - the last admin of an org can't either, or that org's team, billing and
//     seats become unmanageable for everyone in it
export async function deactivateOwnAccount(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const locale = String(formData.get("locale") || "en");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);
  const userId = session.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, deactivatedAt: true },
  });
  if (!user) redirect(`/${locale}/signin`);
  if (user.deactivatedAt) {
    // Already off-boarded in another tab: nothing to do but end the session.
    await signOut({ redirectTo: `/${locale}` });
    return accountFail("1");
  }

  // Typed confirmation. The one destructive control on this page that isn't
  // undoable by the user themselves, so it asks for the address rather than
  // trusting a single click — the pattern the desk's order-cancel form uses
  // for the same reason.
  const typedRaw = String(formData.get("confirmEmail") || "");
  const typed = normaliseEmail(typedRaw);
  // What to put back in the form when a guard below refuses.
  const kept = {
    confirmEmail: typedRaw,
    eraseData: formData.get("eraseData") === "on" ? "on" : "",
  };
  if (typed !== normaliseEmail(user.email)) {
    return accountFail("confirm", kept);
  }

  const allUsers = await prisma.user.findMany({
    where: { role: "SUPERADMIN" },
    select: { id: true, role: true, deactivatedAt: true },
  });
  if (!canDeactivateSelf(user, allUsers).ok) {
    return accountFail("last_superadmin", kept);
  }

  // Last-admin check and the write happen in one locked transaction, so two
  // admins leaving at the same moment can't both pass the check.
  const outcome = await deactivateUserUnlessLastAdmin(userId);
  if (!outcome.ok) return accountFail("last_admin", kept);
  // "Also erase my personal data": the account is anonymised, not just
  // switched off (lib/retention.ts). Orders and invoices stay.
  const erase = formData.get("eraseData") === "on";
  if (erase) {
    await anonymiseUser(userId);
    await recordAudit(userId, "user.erased_self", `User:${userId}`);
  } else {
    await recordAudit(userId, "user.deactivated_self", `User:${userId}`, {
      email: user.email,
    });
  }

  await signOut({ redirectTo: `/${locale}` });
  return accountFail("1"); // unreachable: signOut redirects
}
