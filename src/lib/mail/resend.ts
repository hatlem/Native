import { Resend } from "resend";
import type { EmailAdapter } from "@/lib/notify";

// Factory returns null when no API key is set — the boot path (mail/index.ts)
// then leaves the existing console adapter in place. That way `pnpm dev`
// works offline and CI works without secrets, while every "real" send is
// visible in the [email] log line.
export function makeResendAdapter(
  env: NodeJS.ProcessEnv = process.env,
): EmailAdapter | null {
  const key = env.RESEND_API_KEY;
  if (!key) return null;
  const client = new Resend(key);
  const from = env.AUTH_EMAIL_FROM ?? "NativeSpin <noreply@nativespin.com>";
  const replyTo = env.AUTH_EMAIL_REPLY_TO;
  return async (msg) => {
    await client.emails.send({
      from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      replyTo,
    });
  };
}
