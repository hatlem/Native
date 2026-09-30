// Pure pieces of the writer-invite flow: form validation and the state the
// desk's invite form renders. Kept out of the "use server" action module,
// which may only export async functions.

import { z } from "zod";
import { asEmailLocale, type EmailLocale } from "./email-locale";

export type WriterInviteState =
  | { status: "idle" }
  // Invite created and emailed.
  | { status: "sent"; email: string }
  // Invite created but the email failed — the desk can resend it or share
  // the link shown in the pending list.
  | { status: "notSent"; email: string }
  | { status: "error"; code: "invalidEmail" | "existingAccount" };

export const WRITER_INVITE_IDLE: WriterInviteState = { status: "idle" };

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  locale: z.string(),
});

export function parseWriterInviteForm(
  formData: FormData,
): { ok: true; email: string; locale: EmailLocale } | { ok: false } {
  const parsed = inviteSchema.safeParse({
    email: formData.get("email") ?? "",
    locale: formData.get("inviteLocale") ?? "",
  });
  if (!parsed.success) return { ok: false };
  return { ok: true, email: parsed.data.email, locale: asEmailLocale(parsed.data.locale) ?? "en" };
}

// Absolute claim link for an invite. Built from the app's canonical origin
// (appUrl) so it works from any inbox; the path is locale-prefixed so the
// writer lands in the language the invite was written in.
export function writerClaimPath(locale: string, token: string): string {
  return `/${locale}/writer/claim/${encodeURIComponent(token)}`;
}
