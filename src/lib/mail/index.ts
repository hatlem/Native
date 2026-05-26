// Side-effect import: installs the Resend adapter if RESEND_API_KEY is set,
// otherwise leaves the existing console adapter from notify.ts in place.
// Imported once from src/auth.ts so it runs at server boot.

import { setEmailAdapter } from "@/lib/notify";
import { makeResendAdapter } from "./resend";

const adapter = makeResendAdapter();
if (adapter) setEmailAdapter(adapter);
