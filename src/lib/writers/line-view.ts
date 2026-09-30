// Everything the writer's line page shows about one assignment: what to
// write (title, format, market), the brief, the format spec, the matching
// playbook, and the current draft. Access is checked by the caller
// (requireLineWriter) before this runs.

import { prisma } from "@/lib/prisma";
import { loadPlaybookFor } from "@/lib/playbook";
import { resolveEffectiveAsset, type EffectiveAsset } from "./placement";

export async function loadWriterLineView(lineId: string) {
  const line = await prisma.orderLine.findUnique({
    where: { id: lineId },
    select: {
      id: true,
      productId: true,
      order: {
        select: {
          id: true,
          status: true,
          quote: { select: { request: { select: { briefSummary: true } } } },
        },
      },
      brief: {
        select: {
          message: true,
          audience: true,
          references: true,
          doNotes: true,
          dontNotes: true,
        },
      },
      articlePlacement: {
        select: {
          id: true,
          articleId: true,
          lockedAssetId: true,
          retractedAt: true,
        },
      },
    },
  });
  if (!line) return null;

  const product = line.productId
    ? await prisma.product.findUnique({
        where: { id: line.productId },
        select: {
          type: true,
          spec: true,
          title: {
            select: {
              name: true,
              countryCode: true,
              category: true,
              market: { select: { disclosureLabel: true } },
            },
          },
        },
      })
    : null;

  const latest: EffectiveAsset | null = line.articlePlacement
    ? await resolveEffectiveAsset(line.articlePlacement)
    : null;

  const playbook = product
    ? await loadPlaybookFor(product.type, product.title.category, product.title.countryCode)
    : null;

  // The desk's per-line brief message is copied from the plan's goal, which
  // is optional — fall back to the buyer's own brief for the request so
  // the writer still sees what the campaign is about.
  const message =
    line.brief?.message?.trim() || line.order.quote.request.briefSummary?.trim() || null;

  return {
    lineId: line.id,
    orderStatus: line.order.status,
    product,
    brief: {
      message,
      audience: line.brief?.audience?.trim() || null,
      references: line.brief?.references?.trim() || null,
      doNotes: line.brief?.doNotes?.trim() || null,
      dontNotes: line.brief?.dontNotes?.trim() || null,
    },
    placement: line.articlePlacement,
    latest,
    playbook,
  };
}

export type WriterLineView = NonNullable<Awaited<ReturnType<typeof loadWriterLineView>>>;
