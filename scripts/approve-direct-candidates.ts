#!/usr/bin/env tsx
/**
 * Promotes high-confidence scraped candidates to SalesContacts — but ONLY for
 * DIRECT titles, and ONLY the single best candidate per publisher.
 *
 * Why not the desk's bulkApproveAboveConfidence:
 *  - It is channel-blind: it would promote a high-scoring editorial inbox for
 *    an IN_HOUSE title (the wrong door — those go through the sales house, see
 *    scripts/load-sales-house-contacts.ts).
 *  - It approves EVERY candidate ≥ threshold, so a publisher with 3 strong
 *    candidates gets 3 SalesContacts all emailed about the same titles.
 *
 * This script attaches the contact to the publisher's DIRECT titles only, and
 * picks one primary candidate per publisher (highest confidence, oldest as
 * tie-break). Other candidates stay PENDING for desk review.
 *
 * Run:  pnpm tsx scripts/approve-direct-candidates.ts          (dry-run)
 *       APPLY=1 pnpm tsx scripts/approve-direct-candidates.ts  (write)
 *       MIN_CONFIDENCE=70 APPLY=1 pnpm tsx scripts/...          (override ≥80)
 *
 * Idempotent — skips candidates already APPROVED and get-or-creates the
 * SalesContact, so reruns are no-ops.
 */
import { prisma } from "@/lib/prisma";
import { createSalesContact, attachContactToTitle, normaliseEmail } from "@/lib/pricing/contacts";
import { recordAudit } from "@/lib/audit";

const APPLY = process.env.APPLY === "1";
const MIN_CONFIDENCE = parseInt(process.env.MIN_CONFIDENCE || "80", 10);
const ACTOR_ID = process.env.ACTOR_ID || "cmpmdiqtg048c0hu080m8kmok"; // superadmin@nativespin.com

async function main() {
  console.log(`[approve-direct] ${APPLY ? "APPLY" : "DRY-RUN"} — confidence ≥ ${MIN_CONFIDENCE}`);

  // Publishers that have at least one DIRECT title, with those titles' ids.
  const directTitles = await prisma.title.findMany({
    where: { salesChannel: "DIRECT" },
    select: { id: true, publisherId: true },
  });
  const directTitlesByPub = new Map<string, string[]>();
  for (const t of directTitles) {
    const arr = directTitlesByPub.get(t.publisherId) ?? [];
    arr.push(t.id);
    directTitlesByPub.set(t.publisherId, arr);
  }

  // Best PENDING candidate (≥ min) per such publisher.
  const cands = await prisma.contactCandidate.findMany({
    where: {
      status: "PENDING",
      confidence: { gte: MIN_CONFIDENCE },
      publisherId: { in: [...directTitlesByPub.keys()] },
    },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
    select: { id: true, publisherId: true, email: true, name: true, role: true, phone: true, confidence: true },
  });

  const bestByPub = new Map<string, (typeof cands)[number]>();
  for (const c of cands) if (!bestByPub.has(c.publisherId)) bestByPub.set(c.publisherId, c);

  let approved = 0;
  let titlesLinked = 0;
  let skippedExisting = 0;

  for (const [publisherId, cand] of bestByPub) {
    const titleIds = directTitlesByPub.get(publisherId)!;
    if (!APPLY) {
      approved++;
      titlesLinked += titleIds.length;
      continue;
    }

    const email = normaliseEmail(cand.email);
    let sc = await prisma.salesContact.findUnique({
      where: { publisherId_email: { publisherId, email } },
      select: { id: true },
    });
    if (!sc) {
      sc = await createSalesContact({
        publisherId,
        email,
        name: cand.name ?? "Sales",
        role: cand.role ?? undefined,
        phone: cand.phone ?? undefined,
        notes: `Approved from scraped candidate (confidence ${cand.confidence})`,
        actorId: ACTOR_ID,
      });
    } else {
      skippedExisting++;
    }

    for (let i = 0; i < titleIds.length; i++) {
      await attachContactToTitle({ salesContactId: sc.id, titleId: titleIds[i], isPrimary: i === 0, actorId: ACTOR_ID });
      titlesLinked++;
    }

    await prisma.contactCandidate.update({
      where: { id: cand.id },
      data: { status: "APPROVED", reviewedById: ACTOR_ID, reviewedAt: new Date(), salesContactId: sc.id },
    });
    await recordAudit(ACTOR_ID, "candidate.approve", `ContactCandidate:${cand.id}`, {
      salesContactId: sc.id,
      titleCount: titleIds.length,
      via: "approve-direct-candidates",
    });
    approved++;
  }

  console.log("\n── Summary ──");
  console.log("DIRECT publishers w/ ≥1 candidate ≥min :", bestByPub.size);
  console.log(APPLY ? "candidates approved (1/publisher)     :" : "would approve (1/publisher)           :", approved);
  console.log("DIRECT titles linked                  :", titlesLinked);
  if (APPLY) console.log("reused existing SalesContact          :", skippedExisting);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
