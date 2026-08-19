// Pulls a placement's effective asset (locked version if one exists,
// otherwise the article's latest), looks up the placement's product spec +
// title's market, runs `specCheck`, persists the result onto the
// placement — never onto the shared ContentAsset, since two placements of
// the same article can have different product requirements.

import { prisma } from "@/lib/prisma";
import { registerJob } from "@/lib/jobs";
import { specCheck } from "@/lib/spec-check";
import { resolveEffectiveAsset } from "@/lib/writers/placement";

export async function runSpecCheckForPlacement(placementId: string): Promise<void> {
  const placement = await prisma.articlePlacement.findUnique({
    where: { id: placementId },
    include: { orderLine: { select: { productId: true } } },
  });
  if (!placement) return;

  const asset = await resolveEffectiveAsset(placement);
  if (!asset?.body) return; // no text, or an uploaded file — never spec-checked

  const productId = placement.orderLine.productId;
  if (!productId) return;

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
    titleDisclosure: product?.spec?.disclosureLabel ?? null,
    marketDisclosure: product?.title.market.disclosureLabel ?? null,
  });

  await prisma.articlePlacement.update({
    where: { id: placement.id },
    data: {
      specPassed: result.passed,
      specNotes: result.passed
        ? `Spec passed (${result.words} words)`
        : result.issues.join("; "),
    },
  });
}

let registered = false;
export function registerSpecCheckJob(): void {
  if (registered) return;
  registered = true;
  registerJob<{ placementId: string }>("spec.check", async ({ placementId }) => {
    await runSpecCheckForPlacement(placementId);
  });
}
