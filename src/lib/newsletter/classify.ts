import type { SubscriberStatus } from "@prisma/client";

export type SubscribeDecision = "SEND_CONFIRM" | "SILENT_OK";

// Both branches return the SAME success message to the user upstream, so an
// attacker can't probe which emails are subscribed. Suppressed emails
// (hard bounce / spam complaint) are never re-mailed.
export function classifySubscribe(args: {
  existingStatus: SubscriberStatus | null;
  suppressed: boolean;
}): SubscribeDecision {
  if (args.suppressed) return "SILENT_OK";
  if (args.existingStatus === "CONFIRMED") return "SILENT_OK";
  return "SEND_CONFIRM";
}
