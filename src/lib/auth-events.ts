import { prisma } from "@/lib/prisma";
import { emailAdapter } from "@/lib/notify";
import { newSigninAlertEmail } from "@/lib/mail/templates/new-signin-alert";
import { recordAudit } from "@/lib/audit";

// Pure decision — extracted so the policy is unit-testable.
// "unknown" / "" mean we couldn't read the IP (e.g. dev box, no proxy
// header) and we'd rather skip the alert than email on noise.
export function shouldAlertOnNewSignin(
  lastIp: string | null | undefined,
  currentIp: string,
): boolean {
  if (!currentIp || currentIp === "unknown") return false;
  if (!lastIp) return false;
  return lastIp !== currentIp;
}

export type RecordSignInArgs = {
  userId: string;
  userEmail: string;
  ip: string;
  locale: string;
  appName: string;
  resetUrl: string;
};

// Called from server actions after a successful sign-in. Compares the
// current IP to user.lastSignInIp, fires the alert email if it differs,
// and updates both lastSignInIp and lastSignInAt. Best-effort: any failure
// here is logged and swallowed.
export async function recordSignIn(args: RecordSignInArgs): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: args.userId },
      select: { lastSignInIp: true },
    });
    const now = new Date();
    const alert = shouldAlertOnNewSignin(user?.lastSignInIp ?? null, args.ip);

    await prisma.user.update({
      where: { id: args.userId },
      data: { lastSignInIp: args.ip, lastSignInAt: now },
    });

    if (alert) {
      const msg = newSigninAlertEmail({
        ip: args.ip,
        at: now.toISOString().replace("T", " ").slice(0, 16) + " UTC",
        resetUrl: args.resetUrl,
        locale: args.locale,
        appName: args.appName,
      });
      try {
        await emailAdapter({
          to: args.userEmail,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        });
      } catch (err) {
        console.error("auth.new_signin_email_failed", { userId: args.userId, err });
      }
      await recordAudit(args.userId, "auth.new_signin_alert", `User:${args.userEmail}`, {
        oldIp: user?.lastSignInIp ?? null,
        newIp: args.ip,
      });
    }
  } catch (err) {
    console.error("auth.record_signin_failed", { userId: args.userId, err });
  }
}
