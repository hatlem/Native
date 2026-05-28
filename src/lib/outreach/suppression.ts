import { prisma } from "@/lib/prisma";
import { normaliseEmail } from "./dedup";

export async function addSuppression(args: { email: string; reason: string }): Promise<void> {
  const email = normaliseEmail(args.email);
  await prisma.outreachSuppression.upsert({
    where: { email },
    update: {}, // first-reason-wins is intentional; we don't want a bounce to overwrite a user's unsubscribe
    create: { email, reason: args.reason },
  });
}

export async function isSuppressed(email: string): Promise<boolean> {
  const row = await prisma.outreachSuppression.findUnique({
    where: { email: normaliseEmail(email) },
  });
  return !!row;
}

export async function suppressedEmailSet(): Promise<Set<string>> {
  const rows = await prisma.outreachSuppression.findMany({ select: { email: true } });
  return new Set(rows.map((r) => r.email));
}
