"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Persist that the buyer has dismissed (or completed) the help-call nudge, so
// it stays hidden across visits/devices. Idempotent; safe to call repeatedly.
export async function dismissBookingPrompt(): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return;
  await prisma.user.update({
    where: { id: userId },
    data: { bookingPromptDismissedAt: new Date() },
  });
}
