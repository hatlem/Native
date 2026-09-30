"use server";

import { emailAdapter } from "@/lib/notify";
import { RateLimiter } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/client-ip";
import {
  parseContactInput,
  CONTACT_FIELDS,
  type ContactField,
  type ContactFieldError,
} from "@/lib/contact/validate";
import { buildContactNotification, contactInbox } from "@/lib/contact/email";

export type ContactFormState =
  | { status: "idle" }
  | { status: "sent" }
  | {
      status: "error";
      error: "fields" | "rate" | "send_failed";
      fieldErrors?: Partial<Record<ContactField, ContactFieldError>>;
      // Echoed back so the form can refill itself: React resets an
      // uncontrolled form once its action settles.
      values: Partial<Record<ContactField, string>>;
    };

// A real person sends a handful of messages at most; a script sends
// hundreds. Per IP and per sender address, like the newsletter form.
const contactLimiter = new RateLimiter(5, 5 / 3600);

const LOCALES = new Set(["en", "no", "sv", "da", "fi", "de"]);

// Public /contact form. Replaces a `mailto:` form action, which the CSP
// (`form-action 'self'`) blocked outright — and which never worked for
// webmail users anyway. The message goes to the team inbox through the
// same email adapter as every other mail, with Reply-To set to the sender.
export async function sendContactMessage(
  _prev: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  const field = (k: string) => String(formData.get(k) ?? "");
  const values = Object.fromEntries(CONTACT_FIELDS.map((k) => [k, field(k)])) as Record<
    ContactField,
    string
  >;
  const rawLocale = field("locale");
  const locale = LOCALES.has(rawLocale) ? rawLocale : "en";

  const parsed = parseContactInput({ ...values, website: field("website") });
  // Honeypot: report success so the bot learns nothing, send nothing.
  if (!parsed.ok && parsed.honeypot) return { status: "sent" };
  if (!parsed.ok) {
    return { status: "error", error: "fields", fieldErrors: parsed.fieldErrors, values };
  }

  const ip = await clientIp();
  const [ipCheck, emailCheck] = await Promise.all([
    contactLimiter.check(`contact:ip:${ip}`),
    contactLimiter.check(`contact:email:${parsed.data.email}`),
  ]);
  if (!ipCheck.ok || !emailCheck.ok) {
    return { status: "error", error: "rate", values };
  }

  const note = buildContactNotification(parsed.data, { locale });
  try {
    await emailAdapter({
      to: contactInbox(),
      subject: note.subject,
      text: note.text,
      replyTo: note.replyTo,
    });
  } catch (err) {
    // Say so: a form that swallows a failed send is how the mailto: version
    // lost messages silently.
    console.error("contact.send_failed", { err });
    return { status: "error", error: "send_failed", values };
  }

  await recordAudit(parsed.data.email, "contact.message_sent", "ContactForm", {
    ip,
    role: parsed.data.role,
    locale,
  });
  return { status: "sent" };
}
