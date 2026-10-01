import { Resend, type CreateEmailOptions, type CreateEmailResponse } from "resend";
import type { EmailAdapter } from "@/lib/notify";

export type ResendEmailClient = {
  emails: { send: (payload: CreateEmailOptions) => Promise<CreateEmailResponse> };
};

export class EmailSendError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number | null,
    message: string,
  ) {
    super(`Resend rejected email (${code}${statusCode ? ` ${statusCode}` : ""}): ${message}`);
    this.name = "EmailSendError";
  }
}

// Factory returns null when no API key is set — the boot path (mail/index.ts)
// then leaves the existing console adapter in place. That way `pnpm dev`
// works offline and CI works without secrets, while every "real" send is
// visible in the [email] log line.
export function makeResendAdapter(
  env: NodeJS.ProcessEnv = process.env,
  createClient: (key: string) => ResendEmailClient = (key) => new Resend(key),
): EmailAdapter | null {
  const key = env.RESEND_API_KEY;
  if (!key) return null;
  const client = createClient(key);
  const defaultFrom = env.AUTH_EMAIL_FROM ?? "NativeSpin <noreply@nativespin.com>";
  const defaultReplyTo = env.AUTH_EMAIL_REPLY_TO;
  return async (msg) => {
    const replyTo = msg.replyTo ?? defaultReplyTo;
    const { data, error } = await client.emails.send({
      from: msg.from ?? defaultFrom,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      ...(replyTo ? { replyTo } : {}),
      ...(msg.headers ? { headers: msg.headers } : {}),
    });
    if (error) throw new EmailSendError(error.name, error.statusCode, error.message);
    if (!data?.id) throw new EmailSendError("missing_id", null, "response had no email id");
  };
}
