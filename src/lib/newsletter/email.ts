export type ConfirmEmailUrls = { confirmUrl: string; unsubUrl: string };
export type BuiltEmail = { subject: string; text: string; html: string };

// English-only transactional confirmation. Kept deliberately plain; the
// marketing pages carry the localised copy, this is a one-click confirm.
export function buildConfirmEmail({ confirmUrl, unsubUrl }: ConfirmEmailUrls): BuiltEmail {
  const subject = "Confirm your NativeSpin subscription";
  const text = [
    "Thanks for signing up to NativeSpin.",
    "",
    "Confirm your email to start receiving updates:",
    confirmUrl,
    "",
    "Didn't sign up? Ignore this email, or unsubscribe:",
    unsubUrl,
  ].join("\n");
  const html = [
    `<p>Thanks for signing up to NativeSpin.</p>`,
    `<p><a href="${confirmUrl}">Confirm your subscription</a></p>`,
    `<p style="color:#666;font-size:13px">Didn't sign up? `,
    `<a href="${unsubUrl}">Unsubscribe</a>.</p>`,
  ].join("");
  return { subject, text, html };
}
