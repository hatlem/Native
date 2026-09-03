// Pure validation for the signed-in "change my email" flow.
//
// The address only moves once the link sent to the NEW mailbox is clicked
// (see consumeEmailChangeToken in @/lib/auth-tokens) — everything here runs
// before that mail goes out, so the user gets told about a typo or a taken
// address immediately rather than by silence.

export type EmailChangeVerdict =
  | { ok: true; email: string }
  | { ok: false; reason: EmailChangeDenyReason };

// Reasons double as the ?error= codes on /account — see @/lib/account-messages.
export type EmailChangeDenyReason = "email_invalid" | "email_same";

// Same shape as the check in title-actions.sendPublisherInvite: one @, a dot
// in the domain, no whitespace. Deliberately lenient — the confirmation mail
// is the real validator, and a regex that rejects a valid exotic address is a
// worse failure than one that lets a bounce happen.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateEmailChange(
  currentEmail: string,
  rawNextEmail: string,
): EmailChangeVerdict {
  const next = normaliseEmail(rawNextEmail);
  if (!next || next.length > 254 || !EMAIL_RE.test(next)) {
    return { ok: false, reason: "email_invalid" };
  }
  // Case-only edits ("Ada@corp.com" → "ada@corp.com") are a no-op, not a
  // change: we store addresses lowercased, so sending a confirmation mail
  // for one would be a link that changes nothing.
  if (next === normaliseEmail(currentEmail)) {
    return { ok: false, reason: "email_same" };
  }
  return { ok: true, email: next };
}
