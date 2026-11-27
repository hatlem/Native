// Side-effect import: installs the real email adapter at server boot.
// Imported once from src/auth.ts.
//
// Order: GetMailer when GETMAILER_API_KEY is set (nativespin.com is sent
// through GetMailer's own relay), else Resend when RESEND_API_KEY is set,
// else the console adapter from notify.ts stays in place (dev, CI).

import { setEmailAdapter } from "@/lib/notify";
import { log } from "@/lib/log";
import { makeGetMailerAdapter } from "./getmailer";
import { makeResendAdapter } from "./resend";

const adapter =
  makeGetMailerAdapter(process.env, {
    onSuppressed: async (emails) => {
      // Lazy import keeps prisma out of the adapter module graph for tests.
      const { addSuppression } = await import("@/lib/outreach/suppression");
      for (const email of emails) {
        try {
          await addSuppression({ email, reason: "provider_suppressed" });
        } catch (err) {
          log.error("email.suppression_mirror_failed", { err });
        }
      }
    },
  }) ?? makeResendAdapter();
if (adapter) setEmailAdapter(adapter);
