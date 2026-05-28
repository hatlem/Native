import { prisma } from "@/lib/prisma";
import { createSalesContact, attachContactToTitle } from "@/lib/pricing/contacts";
import { recordAudit } from "@/lib/audit";

export async function approveCandidate(args: {
  candidateId: string;
  reviewedById: string;
  overrides?: { name?: string; email?: string; role?: string; phone?: string };
}): Promise<{ salesContactId: string }> {
  const cand = await prisma.contactCandidate.findUniqueOrThrow({
    where: { id: args.candidateId },
    include: { publisher: { include: { titles: { select: { id: true } } } } },
  });

  const sc = await createSalesContact({
    publisherId: cand.publisherId,
    email: args.overrides?.email ?? cand.email,
    name: args.overrides?.name ?? cand.name ?? "Sales",
    role: args.overrides?.role ?? cand.role ?? undefined,
    phone: args.overrides?.phone ?? cand.phone ?? undefined,
    actorId: args.reviewedById,
  });

  // Attach to every title under this publisher; mark first as primary.
  const titles = cand.publisher.titles;
  for (let i = 0; i < titles.length; i++) {
    await attachContactToTitle({
      salesContactId: sc.id,
      titleId: titles[i].id,
      isPrimary: i === 0,
      actorId: args.reviewedById,
    });
  }

  await prisma.contactCandidate.update({
    where: { id: cand.id },
    data: {
      status: "APPROVED",
      reviewedById: args.reviewedById,
      reviewedAt: new Date(),
      salesContactId: sc.id,
    },
  });

  await recordAudit(args.reviewedById, "candidate.approve", `ContactCandidate:${cand.id}`, {
    salesContactId: sc.id,
    titleCount: titles.length,
  });

  return { salesContactId: sc.id };
}

export async function rejectCandidate(args: {
  candidateId: string;
  reviewedById: string;
  reason?: string;
}): Promise<void> {
  await prisma.contactCandidate.update({
    where: { id: args.candidateId },
    data: {
      status: "REJECTED",
      reviewedById: args.reviewedById,
      reviewedAt: new Date(),
    },
  });
  await recordAudit(args.reviewedById, "candidate.reject", `ContactCandidate:${args.candidateId}`, {
    reason: args.reason ?? null,
  });
}

export async function bulkApproveAboveConfidence(args: {
  minConfidence: number;
  reviewedById: string;
}): Promise<{ approved: number; failed: number }> {
  const candidates = await prisma.contactCandidate.findMany({
    where: { status: "PENDING", confidence: { gte: args.minConfidence } },
    select: { id: true },
  });

  let approved = 0;
  let failed = 0;

  for (const c of candidates) {
    try {
      await approveCandidate({ candidateId: c.id, reviewedById: args.reviewedById });
      approved++;
    } catch {
      failed++;
    }
  }

  return { approved, failed };
}
