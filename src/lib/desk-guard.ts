import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { enforceStaffMfa, staffMfaRequired } from "@/lib/mfa/enforce";
import { isMfaEnabled } from "@/lib/mfa/store";

// ── Desk context ────────────────────────────────────────────────────────
// Proof that the caller passed a desk guard. Every desk data loader in
// src/lib/data/desk takes one as its first argument, so a page cannot read
// desk data without having run a guard first — the check a page used to
// have to remember (and seven once forgot) is now a type error to omit.
//
// The brand is module-private: the only way to get a DeskContext is from
// requireDeskContext / superadminPageGate below. The registry also makes it
// a runtime fact, so a cast cannot forge one. It hangs off globalThis so
// every bundle layer shares it.
declare const deskContextBrand: unique symbol;
export type DeskContext = {
  readonly userId: string;
  readonly role: "DESK" | "SUPERADMIN";
  readonly [deskContextBrand]: true;
};
export type SuperadminContext = DeskContext & { readonly role: "SUPERADMIN" };

const REGISTRY_KEY = Symbol.for("nativespin.deskContextRegistry");
function registry(): WeakSet<object> {
  const g = globalThis as { [REGISTRY_KEY]?: WeakSet<object> };
  return (g[REGISTRY_KEY] ??= new WeakSet<object>());
}

function mintDeskContext<R extends "DESK" | "SUPERADMIN">(
  userId: string,
  role: R,
): DeskContext & { readonly role: R } {
  const ctx = Object.freeze({ userId, role }) as DeskContext & { readonly role: R };
  registry().add(ctx);
  return ctx;
}

// Called first by every desk loader. Throws for anything a guard did not mint.
export function assertDeskContext(ctx: DeskContext): void {
  if (typeof ctx !== "object" || ctx === null || !registry().has(ctx)) {
    throw new Error("Desk data loader called without a desk context");
  }
}

// As assertDeskContext, for the loaders behind SUPERADMIN-only pages.
export function assertSuperadminContext(ctx: SuperadminContext): void {
  assertDeskContext(ctx);
  if (ctx.role !== "SUPERADMIN") {
    throw new Error("Superadmin data loader called with a desk context");
  }
}

// Gate a desk-only page: anyone without the DESK or SUPERADMIN role is
// bounced to sign-in. Returns the context the desk loaders require.
export async function requireDeskContext(locale: string): Promise<DeskContext> {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }
  // MFA_REQUIRED_FOR_STAFF=1: staff without two-factor are sent to enrol.
  await enforceStaffMfa(session.user.id, role, locale);
  return mintDeskContext(session.user.id, role);
}

// Gate a desk-only action that is bound from a client component rather than
// posted as a form: it has no locale to redirect with, so it throws and the
// caller surfaces the error. Same role rule as requireDeskContext.
export async function requireDeskContextOrThrow(): Promise<DeskContext> {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    throw new Error("forbidden");
  }
  // No locale to redirect with: refuse instead of sending staff to enrol.
  if (staffMfaRequired() && !(await isMfaEnabled(session.user.id))) {
    throw new Error("mfa-required");
  }
  return mintDeskContext(session.user.id, role);
}

// Gate a desk-only server action: anyone without the DESK or SUPERADMIN
// role is bounced to sign-in. Returns the acting user id for audit rows.
// Same shape as requireLineWriter in @/lib/writers/guard.
export async function requireDesk(locale: string): Promise<string> {
  return (await requireDeskContext(locale)).userId;
}

export type SuperadminPageGate =
  | { allowed: true; userId: string; ctx: SuperadminContext }
  | { allowed: false };

// Gate for a SUPERADMIN-only desk *page*. Signed-out visitors go to
// sign-in (so the callback lands them back here). A signed-in user with
// any other role is NOT redirected: the caller renders <SuperadminOnly />
// instead. A silent bounce to /desk made DESK users conclude the link was
// broken — an explicit "this page is for superadmins" state tells them
// the page exists, why they can't see it, and who to ask.
//
//   const gate = await superadminPageGate(locale);
//   if (!gate.allowed) return <SuperadminOnly locale={locale} area={t("title")} />;
export async function superadminPageGate(locale: string): Promise<SuperadminPageGate> {
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);
  if (session.user.role !== "SUPERADMIN") return { allowed: false };
  await enforceStaffMfa(session.user.id, session.user.role, locale);
  return {
    allowed: true,
    userId: session.user.id,
    ctx: mintDeskContext(session.user.id, "SUPERADMIN"),
  };
}

// Gate a SUPERADMIN-only server action. Anyone else is bounced to
// `redirectTo` (sign-in by default). Returns the acting user id for audit
// rows. The one definition of this check — it used to be copy-pasted into
// each actions file, which is how a guard goes missing.
export async function requireSuperadmin(
  locale: string,
  redirectTo: string = `/${locale}/signin`,
): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "SUPERADMIN") {
    redirect(redirectTo);
  }
  await enforceStaffMfa(session.user.id, session.user.role, locale);
  return session.user.id;
}

// requireDesk for callers that need the whole session user (name, email).
export async function requireDeskSession(locale: string) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }
  await enforceStaffMfa(session.user.id, role, locale);
  return session.user;
}
