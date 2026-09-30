import { z } from "zod";

// Public contact form (/contact). Pure parsing so the rules are testable
// without a request scope; the server action in src/app/contact-actions.ts
// owns rate limiting and delivery.

export const CONTACT_ROLES = ["advertiser", "agency", "publisher", "other"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const CONTACT_FIELDS = ["name", "email", "organisation", "role", "message"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

export type ContactFieldError = "required" | "invalid" | "too_long";

export type ContactMessage = {
  name: string;
  email: string;
  organisation: string;
  role: ContactRole;
  message: string;
};

export type ContactRaw = Record<ContactField | "website", string>;

export type ContactParsed =
  | { ok: true; data: ContactMessage }
  | { ok: false; honeypot: true }
  | { ok: false; honeypot: false; fieldErrors: Partial<Record<ContactField, ContactFieldError>> };

// Single-line fields end up in the notification's subject line, so line
// breaks are folded to spaces rather than trusted.
const singleLine = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\r\n]+/g, " ").trim())
    .pipe(z.string().max(max, "too_long"));

const schema = z.object({
  name: singleLine(120).pipe(z.string().min(1, "required")),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().min(1, "required").max(254, "too_long").pipe(z.email("invalid"))),
  organisation: singleLine(160),
  role: z.enum(CONTACT_ROLES, "invalid"),
  message: z.string().trim().pipe(z.string().min(1, "required").max(5000, "too_long")),
});

// `website` is the same hidden honeypot the newsletter form uses: people
// never fill it, form-spamming bots do.
export function parseContactInput(raw: ContactRaw): ContactParsed {
  if (raw.website.trim() !== "") return { ok: false, honeypot: true };
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };

  const fieldErrors: Partial<Record<ContactField, ContactFieldError>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as ContactField;
    if (fieldErrors[field]) continue;
    fieldErrors[field] =
      issue.message === "required" || issue.message === "too_long"
        ? issue.message
        : "invalid";
  }
  return { ok: false, honeypot: false, fieldErrors };
}
