import type { ContactMessage, ContactRole } from "./validate";

// The team's contact inbox — the address the old mailto: form posted to and
// the one the site footer and /about publish. CONTACT_INBOX overrides it
// (e.g. to route form mail to a shared helpdesk) without a deploy of code.
export const DEFAULT_CONTACT_INBOX = "hello@nativespin.com";

export function contactInbox(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.CONTACT_INBOX?.trim() || DEFAULT_CONTACT_INBOX;
}

const ROLE_LABEL: Record<ContactRole, string> = {
  advertiser: "Advertiser",
  agency: "Agency",
  publisher: "Publisher",
  other: "Other",
};

// Internal notification to the team: English, plain text (it's read in a
// mail client, answered with Reply). replyTo is the sender, so answering
// the notification answers them.
export function buildContactNotification(
  msg: ContactMessage,
  meta: { locale: string },
): { subject: string; text: string; replyTo: string } {
  const who = msg.organisation ? `${msg.name} (${msg.organisation})` : msg.name;
  const subject = `Contact form · ${ROLE_LABEL[msg.role]} · ${who}`;
  const text = [
    `New message from the contact form on nativespin.com.`,
    ``,
    `Name:     ${msg.name}`,
    `Email:    ${msg.email}`,
    `Company:  ${msg.organisation || "(not given)"}`,
    `Role:     ${ROLE_LABEL[msg.role]}`,
    `Language: ${meta.locale}`,
    ``,
    msg.message,
    ``,
    `Reply to this email to answer ${msg.name} directly.`,
  ].join("\n");
  return { subject, text, replyTo: msg.email };
}
