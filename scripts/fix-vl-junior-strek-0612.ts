/** Vårt Land thread (Thomas Myhrvold, Annonseansvarlig, 2026-06-04/11) ground-truth fixes:
 *
 * 1) "Vårt Land Junior" — the publisher states verbatim "Vårt Land Junior er det ikke
 *    noe som heter. KI som har rota her?" i.e. it does not exist (an AI-seed
 *    hallucination). It currently sits active=true with verificationStatus
 *    DISCONTINUED but no discontinuedAt — a half-deactivated state. Finalize it:
 *    active=false + discontinuedAt + PUBLISHER_CONFIRMED [FAKE] note (strongest signal).
 *
 * 2) "Strek" vs "Magasinet Strek" (same site strekmag.no) — "Strek" is the duplicate
 *    (DISCONTINUED status but still active=true); "Magasinet Strek" is the LIVE
 *    survivor. Finalize the duplicate (active=false + discontinuedAt) and fold the
 *    name "Strek" into the survivor's aliases so search still finds it. Record on the
 *    survivor that it is print-only (no digital advertising), per the publisher.
 *
 * Dry-run by default; --apply to write.
 */
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");
const NOW = new Date("2026-06-12T00:00:00.000Z");

const VL_JUNIOR = "cmpmdiqa8024q0hu0t9x2o0gw";
const STREK_DUP = "cmpmdiqa7023a0hu0gneujj0o";       // "Strek"
const STREK_SURVIVOR = "cmpmdiqa401zj0hu0obhkyduz";  // "Magasinet Strek"

async function main() {
  // 1) Vårt Land Junior — publisher-confirmed non-existent
  const j = await prisma.title.findUnique({ where: { id: VL_JUNIOR }, select: { name: true, active: true, discontinuedAt: true } });
  console.log(`VL Junior: active=${j?.active} discontinuedAt=${j?.discontinuedAt}`);
  if (APPLY && j)
    await prisma.title.update({
      where: { id: VL_JUNIOR },
      data: {
        active: false, verificationStatus: "DISCONTINUED", discontinuedAt: j.discontinuedAt ?? NOW,
        discontinuedNote: "[FAKE – PUBLISHER_CONFIRMED 2026-06-04] Thomas Myhrvold (Annonseansvarlig, Vårt Land, thomasm@vl.no): «Vårt Land Junior er det ikke noe som heter. KI som har rota her?» — the publisher confirms no such title exists (AI-seed hallucination).",
        verificationSource: "email:thomasm@vl.no 2026-06-04", lastVerifiedAt: NOW,
      },
    });

  // 2) Strek duplicate → deactivate + alias into survivor
  const dup = await prisma.title.findUnique({ where: { id: STREK_DUP }, select: { name: true, active: true, discontinuedAt: true } });
  const surv = await prisma.title.findUnique({ where: { id: STREK_SURVIVOR }, select: { name: true, aliases: true } });
  console.log(`Strek dup: active=${dup?.active}; survivor "${surv?.name}" aliases=${JSON.stringify(surv?.aliases)}`);
  if (APPLY && dup)
    await prisma.title.update({
      where: { id: STREK_DUP },
      data: {
        active: false, verificationStatus: "DISCONTINUED", discontinuedAt: dup.discontinuedAt ?? NOW,
        discontinuedNote: "[DUPLICATE 2026-06-12] Same publication as 'Magasinet Strek' (strekmag.no). Folded into the survivor; name kept as alias.",
        lastVerifiedAt: NOW,
      },
    });
  if (APPLY && surv) {
    const addAliases = ["Strek"].filter((a) => a !== surv.name && !surv.aliases.includes(a));
    await prisma.title.update({
      where: { id: STREK_SURVIVOR },
      data: {
        ...(addAliases.length ? { aliases: { set: [...surv.aliases, ...addAliases] } } : {}),
        offersNativeContent: false, // publisher: print only, no digital advertising
        outstandingInfo: { set: ["Kun print – ingen digitale annonsemuligheter (Thomas Myhrvold/Vårt Land, 2026-06-04)"] },
        lastVerifiedAt: NOW, verificationSource: "email:thomasm@vl.no 2026-06-04",
      },
    });
  }

  console.log(APPLY ? "APPLIED" : "DRY RUN");
}
main().finally(() => prisma.$disconnect());
