import { randomBytes } from "node:crypto";
import type { MembershipRole } from "./membership";

const TOKEN_BYTES = 24;
export const ORG_INVITE_TTL_DAYS = 14;

export function newInviteToken(): string {
  return randomBytes(TOKEN_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function expiryFromNow(days: number = ORG_INVITE_TTL_DAYS, now: Date = new Date()): Date {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

type Locale = "en" | "no" | "sv" | "da" | "fi" | "de";

export type OrgInviteShape = { email: string; expiresAt: Date; claimedAt: Date | null };

export type InviteVerdict =
  | { ok: true }
  | { ok: false; reason: "missing" | "expired" | "claimed" };

export function checkOrgInvite(invite: OrgInviteShape | null | undefined, now: Date = new Date()): InviteVerdict {
  if (!invite) return { ok: false, reason: "missing" };
  if (invite.claimedAt) return { ok: false, reason: "claimed" };
  if (invite.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

export type ClaimContext = { authedEmail: string | null; isAlreadyMember: boolean };

export type ClaimVerdict =
  | { ok: true; mode: "new" | "existing" }
  | { ok: false; reason: "missing" | "expired" | "claimed" | "email_mismatch" | "already_member" };

export function validateOrgClaim(
  invite: OrgInviteShape | null | undefined,
  ctx: ClaimContext,
  now: Date = new Date(),
): ClaimVerdict {
  const base = checkOrgInvite(invite, now);
  if (!base.ok) return base;
  if (ctx.isAlreadyMember) return { ok: false, reason: "already_member" };
  if (ctx.authedEmail === null) return { ok: true, mode: "new" };
  if (ctx.authedEmail.toLowerCase() !== invite!.email.toLowerCase()) {
    return { ok: false, reason: "email_mismatch" };
  }
  return { ok: true, mode: "existing" };
}

export function validateDelegationDate(delegationExpiresAt: Date | null, now: Date = new Date()): boolean {
  if (delegationExpiresAt === null) return true;
  return delegationExpiresAt.getTime() > now.getTime();
}

/** Admins must be permanent: an ADMIN role combined with an expiry is forbidden. */
export function isDelegatedAdminForbidden(role: MembershipRole, delegationExpiresAt: Date | null): boolean {
  return role === "ADMIN" && delegationExpiresAt !== null;
}

// ---- Role label lookup (locale × role → natural noun phrase) ----

const ROLE_LABELS: Record<Locale, Record<MembershipRole, string>> = {
  en: { ADMIN: "an admin", MEMBER: "a member", RESTRICTED: "a restricted user" },
  no: { ADMIN: "administrator", MEMBER: "medlem", RESTRICTED: "bruker med begrenset tilgang" },
  sv: { ADMIN: "administratör", MEMBER: "medlem", RESTRICTED: "användare med begränsad åtkomst" },
  da: { ADMIN: "administrator", MEMBER: "medlem", RESTRICTED: "bruger med begrænset adgang" },
  fi: { ADMIN: "ylläpitäjä", MEMBER: "jäsen", RESTRICTED: "käyttäjä, jolla on rajoitettu käyttöoikeus" },
  de: { ADMIN: "Administrator", MEMBER: "Mitglied", RESTRICTED: "eingeschränkter Benutzer" },
};

function roleLabel(role: MembershipRole, locale: Locale): string {
  return ROLE_LABELS[locale][role];
}

// ---- Invite email (multilingual; mirrors src/lib/pricing/email.ts) ----

export type OrgInviteEmailArgs = {
  locale: Locale;
  orgName: string;
  inviterName: string;
  link: string;
  role: MembershipRole;
  delegationExpiresAt: Date | null;
};

type Built = { subject: string; text: string };

function dateLabel(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

function en(a: OrgInviteEmailArgs): Built {
  const until = a.delegationExpiresAt
    ? `\nThis is time-limited access until ${dateLabel(a.delegationExpiresAt)}.`
    : "";
  return {
    subject: `You've been invited to ${a.orgName} on NativeSpin`,
    text: [
      `Hi,`,
      ``,
      `${a.inviterName} invited you to join ${a.orgName} on NativeSpin as ${roleLabel(a.role, "en")}.${until}`,
      ``,
      `Accept your invite:`,
      a.link,
      ``,
      `This link is valid for ${ORG_INVITE_TTL_DAYS} days.`,
      ``,
      `NativeSpin`,
    ].join("\n"),
  };
}

function no(a: OrgInviteEmailArgs): Built {
  const until = a.delegationExpiresAt
    ? `\nDette er tidsbegrenset tilgang til ${dateLabel(a.delegationExpiresAt)}.`
    : "";
  return {
    subject: `Du er invitert til ${a.orgName} på NativeSpin`,
    text: [
      `Hei,`,
      ``,
      `${a.inviterName} har invitert deg til ${a.orgName} på NativeSpin som ${roleLabel(a.role, "no")}.${until}`,
      ``,
      `Godta invitasjonen:`,
      a.link,
      ``,
      `Lenken er gyldig i ${ORG_INVITE_TTL_DAYS} dager.`,
      ``,
      `NativeSpin`,
    ].join("\n"),
  };
}

function sv(a: OrgInviteEmailArgs): Built {
  const until = a.delegationExpiresAt
    ? `\nDetta är tidsbegränsad åtkomst till ${dateLabel(a.delegationExpiresAt)}.`
    : "";
  return {
    subject: `Du har bjudits in till ${a.orgName} på NativeSpin`,
    text: [
      `Hej,`,
      ``,
      `${a.inviterName} har bjudit in dig till ${a.orgName} på NativeSpin som ${roleLabel(a.role, "sv")}.${until}`,
      ``,
      `Acceptera inbjudan:`,
      a.link,
      ``,
      `Länken gäller i ${ORG_INVITE_TTL_DAYS} dagar.`,
      ``,
      `NativeSpin`,
    ].join("\n"),
  };
}

function da(a: OrgInviteEmailArgs): Built {
  const until = a.delegationExpiresAt
    ? `\nDette er tidsbegrænset adgang indtil ${dateLabel(a.delegationExpiresAt)}.`
    : "";
  return {
    subject: `Du er inviteret til ${a.orgName} på NativeSpin`,
    text: [
      `Hej,`,
      ``,
      `${a.inviterName} har inviteret dig til ${a.orgName} på NativeSpin som ${roleLabel(a.role, "da")}.${until}`,
      ``,
      `Accepter invitationen:`,
      a.link,
      ``,
      `Linket er gyldigt i ${ORG_INVITE_TTL_DAYS} dage.`,
      ``,
      `NativeSpin`,
    ].join("\n"),
  };
}

function fi(a: OrgInviteEmailArgs): Built {
  const until = a.delegationExpiresAt
    ? `\nTämä on määräaikainen käyttöoikeus ${dateLabel(a.delegationExpiresAt)} asti.`
    : "";
  return {
    subject: `Sinut on kutsuttu organisaatioon ${a.orgName} NativeSpinissä`,
    text: [
      `Hei,`,
      ``,
      `${a.inviterName} kutsui sinut organisaatioon ${a.orgName} NativeSpinissä roolilla ${roleLabel(a.role, "fi")}.${until}`,
      ``,
      `Hyväksy kutsu:`,
      a.link,
      ``,
      `Linkki on voimassa ${ORG_INVITE_TTL_DAYS} päivää.`,
      ``,
      `NativeSpin`,
    ].join("\n"),
  };
}

function de(a: OrgInviteEmailArgs): Built {
  const until = a.delegationExpiresAt
    ? `\nDies ist ein zeitlich begrenzter Zugang bis ${dateLabel(a.delegationExpiresAt)}.`
    : "";
  return {
    subject: `Sie wurden zu ${a.orgName} auf NativeSpin eingeladen`,
    text: [
      `Hallo,`,
      ``,
      `${a.inviterName} hat Sie als ${roleLabel(a.role, "de")} zu ${a.orgName} auf NativeSpin eingeladen.${until}`,
      ``,
      `Einladung annehmen:`,
      a.link,
      ``,
      `Der Link ist ${ORG_INVITE_TTL_DAYS} Tage gültig.`,
      ``,
      `NativeSpin`,
    ].join("\n"),
  };
}

export function buildOrgInviteEmail(args: OrgInviteEmailArgs): Built {
  switch (args.locale) {
    case "no":
      return no(args);
    case "sv":
      return sv(args);
    case "da":
      return da(args);
    case "fi":
      return fi(args);
    case "de":
      return de(args);
    case "en":
    default:
      return en(args);
  }
}

export function orgInviteLink(locale: string, token: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://nativespin.com").replace(/\/$/, "");
  return `${base}/${locale}/invite/${token}`;
}
