// Pulls an asset, looks up the product spec + title's market, runs
// `specCheck`, persists the result. Shared between the desk's manual
// trigger and the queued job kicked off by `saveDraft`.

import { prisma } from "@/lib/prisma";
import { registerJob } from "@/lib/jobs";
import { specCheck } from "@/lib/spec-check";

export async function runSpecCheckForAsset(assetId: string): Promise<void> {
  const asset = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    include: {
      article: { include: { orderLine: { select: { productId: true } } } },
    },
  });
  if (!asset) return;

  // Uploaded files are never spec-checked (no reliable text to check).
  if (!asset.body) return;

  // Spec check needs a placement's Product to know word-count/disclosure
  // requirements. An article not yet linked to a placement has none.
  const productId = asset.article.orderLine?.productId;
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

  await prisma.contentAsset.update({
    where: { id: asset.id },
    data: {
      specPassed: result.passed,
      reviewNotes: result.passed
        ? `Spec passed (${result.words} words)`
        : result.issues.join("; "),
    },
  });
}

let registered = false;
export function registerSpecCheckJob(): void {
  if (registered) return;
  registered = true;
  registerJob<{ assetId: string }>("spec.check", async ({ assetId }) => {
    await runSpecCheckForAsset(assetId);
  });
}
