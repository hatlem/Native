// Pulls a placement's effective asset (locked version if one exists,
// otherwise the article's latest), looks up the placement's product spec +
// title's market, runs `specCheck`, persists the result onto the
// placement — never onto the shared ContentAsset, since two placements of
// the same article can have different product requirements.

import { prisma } from "@/lib/prisma";
import { registerJob } from "@/lib/jobs";
import { specCheck, type SpecResult } from "@/lib/spec-check";
import { resolveEffectiveAsset } from "@/lib/writers/placement";

export type PlacementSpecEvaluation = {
  // The version that was checked — callers compare it with the version
  // they are about to act on, so a result is never applied to another one.
  assetId: string;
  result: SpecResult;
};

// Evaluates without writing anything. Null when there is nothing to check:
// no placement, no text (empty or an uploaded file — uploads are never
// spec-checked), or a line with no product to check against.
export async function evaluateSpecForPlacement(
  placementId: string,
): Promise<PlacementSpecEvaluation | null> {
  const placement = await prisma.articlePlacement.findUnique({
    where: { id: placementId },
    include: { orderLine: { select: { productId: true } } },
  });
  if (!placement) return null;

  const asset = await resolveEffectiveAsset(placement);
  if (!asset?.body) return null;

  const productId = placement.orderLine.productId;
  if (!productId) return null;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      spec: true,
      title: { include: { market: { select: { disclosureLabel: true } } } },
    },
  });
  const result = specCheck({
    body: asset.body,
    wordCountMin: product?.spec?.wordCountMin ?? null,
    wordCountMax: product?.spec?.wordCountMax ?? null,
    imagesMin: product?.spec?.imagesMin ?? null,
    titleDisclosure: product?.spec?.disclosureLabel ?? null,
    marketDisclosure: product?.title.market.disclosureLabel ?? null,
  });
  return { assetId: asset.id, result };
}

// Evaluates and persists onto the placement. Returns the evaluation so a
// caller that gates on it (submit for review) acts on exactly the result
// it just stored.
export async function runSpecCheckForPlacement(
  placementId: string,
): Promise<PlacementSpecEvaluation | null> {
  const evaluation = await evaluateSpecForPlacement(placementId);
  if (!evaluation) return null;
  const { result } = evaluation;
  await prisma.articlePlacement.update({
    where: { id: placementId },
    data: {
      specPassed: result.passed,
      specNotes: result.passed
        ? `Spec passed (${result.words} words)`
        : result.issues.join("; "),
    },
  });
  return evaluation;
}

// The review gate: before `assetId` is handed over for review, re-check it
// against every placement that shows it (unlocked placements show the
// article's latest version) and persist those results. Returns the
// placements whose spec it fails — empty means it may be submitted. Run
// synchronously rather than trusting the stored result, which comes from
// an async job and may predate this version.
export async function specFailuresForSubmission(args: {
  articleId: string;
  assetId: string;
}): Promise<{ placementId: string; evaluation: PlacementSpecEvaluation }[]> {
  const placements = await prisma.articlePlacement.findMany({
    where: { articleId: args.articleId, lockedAssetId: null, retractedAt: null },
    select: { id: true },
  });
  const failing: { placementId: string; evaluation: PlacementSpecEvaluation }[] = [];
  for (const p of placements) {
    const evaluation = await runSpecCheckForPlacement(p.id);
    if (evaluation && evaluation.assetId === args.assetId && !evaluation.result.passed) {
      failing.push({ placementId: p.id, evaluation });
    }
  }
  return failing;
}

let registered = false;
export function registerSpecCheckJob(): void {
  if (registered) return;
  registered = true;
  registerJob<{ placementId: string }>("spec.check", async ({ placementId }) => {
    await runSpecCheckForPlacement(placementId);
  });
}
