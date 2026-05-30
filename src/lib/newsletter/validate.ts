import { z } from "zod";
import { normaliseEmail } from "@/lib/outreach/dedup";

export type SubscribeRaw = { email: string; source: string; website: string };
export type SubscribeParsed =
  | { ok: true; email: string; source: string }
  | { ok: false; error: "invalid_email" | "honeypot" };

const emailSchema = z.string().email();

// `website` is a hidden honeypot field: real users never fill it, bots do.
export function parseSubscribeInput(raw: SubscribeRaw): SubscribeParsed {
  if (raw.website.trim() !== "") return { ok: false, error: "honeypot" };
  const email = normaliseEmail(raw.email);
  if (!emailSchema.safeParse(email).success) return { ok: false, error: "invalid_email" };
  const source = raw.source.trim() || "unknown";
  return { ok: true, email, source };
}
