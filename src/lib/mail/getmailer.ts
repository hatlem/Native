// GetMailer email adapter. GetMailer sends nativespin.com mail through its own
// relay (DKIM s1._domainkey.nativespin.com), so we no longer depend on the
// shared Resend account for delivery.
//
// GetMailer keeps an account-level suppression list fed by its own bounce and
// feedback-loop processing, and refuses or skips suppressed recipients. When
// it reports one, we mirror it into OutreachSuppression through `onSuppressed`
// so outreach stops queueing mail to that address — the job the Resend
// bounce/complaint webhook did before.
import type { EmailAdapter } from "@/lib/notify";
import { EmailSendError } from "./resend";

const DEFAULT_API_URL = "https://api.getmailer.co";
const REQUEST_TIMEOUT_MS = 30_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type GetMailerAdapterOptions = {
  fetchImpl?: FetchLike;
  // Recipients GetMailer refused or skipped because they are on its
  // suppression list (earlier hard bounce or spam complaint).
  onSuppressed?: (emails: string[]) => Promise<void>;
};

type SendResponse = {
  id?: string;
  status?: string;
  error?: string;
  code?: string;
  suppressed?: string[];
  suppressedRecipients?: string[];
};

// Factory returns null when no API key is set, so the boot path can fall back
// to Resend or the console adapter.
export function makeGetMailerAdapter(
  env: NodeJS.ProcessEnv = process.env,
  options: GetMailerAdapterOptions = {},
): EmailAdapter | null {
  const key = env.GETMAILER_API_KEY?.trim();
  if (!key) return null;
  const endpoint = `${(env.GETMAILER_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, "")}/api/emails`;
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const defaultFrom = env.AUTH_EMAIL_FROM ?? "NativeSpin <noreply@nativespin.com>";
  const defaultReplyTo = env.AUTH_EMAIL_REPLY_TO;

  return async (msg) => {
    const replyTo = msg.replyTo ?? defaultReplyTo;
    const body = {
      from: msg.from ?? defaultFrom,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(msg.headers ? { headers: msg.headers } : {}),
    };

    let res: Response;
    try {
      res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new EmailSendError("network_error", null, message, "GetMailer");
    }

    const payload = await readJson(res);
    const suppressed = payload.suppressedRecipients ?? payload.suppressed ?? [];
    if (suppressed.length > 0 && options.onSuppressed) {
      await options.onSuppressed(suppressed);
    }

    if (!res.ok) {
      const code = payload.code ?? (suppressed.length > 0 ? "recipient_suppressed" : `http_${res.status}`);
      throw new EmailSendError(code, res.status, payload.error ?? res.statusText ?? "request failed", "GetMailer");
    }
    if (!payload.id) throw new EmailSendError("missing_id", res.status, "response had no email id", "GetMailer");
  };
}

async function readJson(res: Response): Promise<SendResponse> {
  try {
    const parsed: unknown = await res.json();
    return parsed && typeof parsed === "object" ? (parsed as SendResponse) : {};
  } catch {
    return {};
  }
}
