// Email-change confirmation endpoint. A Route Handler rather than a Page for
// the same reason as the magic-link one: it has to clear the session cookie,
// which a Server Component can't do during render.
//
// The link is clicked from the NEW mailbox, which is very often a different
// browser (a phone) with no session at all — so this must work signed-out.
// Everything it needs is in the token.

import { type NextRequest, NextResponse } from "next/server";
import { signOut } from "@/auth";
import { consumeEmailChangeToken } from "@/lib/auth-tokens";
import { recordAudit } from "@/lib/audit";
import { emailChangeNoticeEmail } from "@/lib/mail/templates/email-change";
import { emailAdapter } from "@/lib/notify";
import { appUrl, appName } from "@/lib/url";

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ locale: string; token: string }> },
) {
  const { locale, token } = await params;
  const ip = clientIp(req);

  const outcome = await consumeEmailChangeToken(token);

  if (!outcome.ok) {
    await recordAudit("anonymous", "user.email_change_invalid", "Token", {
      ip,
      reason: outcome.reason,
    });
    // Both codes render a banner on /account (see @/lib/account-messages);
    // a signed-out visitor is bounced to sign-in by the page itself.
    const code = outcome.reason === "taken" ? "email_taken" : "email_expired";
    return NextResponse.redirect(
      new URL(`/${locale}/account?error=${code}#email`, appUrl()),
    );
  }

  await recordAudit(outcome.userId, "user.email_changed", `User:${outcome.userId}`, {
    from: outcome.oldEmail,
    to: outcome.newEmail,
    ip,
  });

  // Tell the address that just lost the account. This is the second notice
  // the old mailbox gets (the first went out when the change was requested)
  // and the one that says it actually happened.
  const notice = emailChangeNoticeEmail({
    newEmail: outcome.newEmail,
    locale,
    appName: appName(),
  });
  try {
    await emailAdapter({
      to: outcome.oldEmail,
      subject: notice.subject,
      text: notice.text,
      html: notice.html,
    });
  } catch (err) {
    console.error("user.email_changed_notice_failed", {
      userId: outcome.userId,
      err,
    });
  }

  // The JWT still carries the old address (it's minted at sign-in and never
  // re-read from the database), so leaving the session up would show stale
  // identity in the header. Signing out is also the honest security posture
  // for an identity change. No-op when the click came from a browser that
  // was never signed in.
  try {
    await signOut({ redirect: false });
  } catch (err) {
    console.error("user.email_change_signout_failed", {
      userId: outcome.userId,
      err,
    });
  }

  return NextResponse.redirect(
    new URL(`/${locale}/signin?ok=email_changed`, appUrl()),
  );
}
