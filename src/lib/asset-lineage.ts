// Asset lineage helpers — walk the sourceAssetId chain so the desk
// (and future "asset library" UI) can group adaptations under a root.
//
// Why this lives outside the actions: lineage is a *read* concern
// surfaced in multiple places (desk order detail, content-team queue,
// invoice line-item rationale for adaptation rate). Keeping it in a
// pure-ish module lets each caller use the same correctness.

import { prisma } from "@/lib/prisma";

export type LineageNode = {
  id: string;
  version: number;
  status: string;
  articleId: string;
  createdAt: Date;
};

// Walk up to the root of an adaptation chain. Stops at the first
// asset whose sourceAssetId is null. Guards against accidental cycles
// (shouldn't happen given the FK constraints, but defensive: cap at
// 16 hops which is well beyond any realistic adaptation depth).
export async function rootOf(assetId: string): Promise<string | null> {
  let current: string | null = assetId;
  for (let i = 0; i < 16; i += 1) {
    if (!current) return null;
    const row: { id: string; sourceAssetId: string | null } | null =
      await prisma.contentAsset.findUnique({
        where: { id: current },
        select: { id: true, sourceAssetId: true },
      });
    if (!row) return null;
    if (!row.sourceAssetId) return row.id;
    current = row.sourceAssetId;
  }
  // Cycle or absurdly deep chain — return what we have rather than
  // throwing; the desk would rather see "couldn't find a clean root"
  // than a 500.
  return current;
}

// All descendants of a root: returns the immediate adaptations plus
// any second-generation adaptations of those. Used by the asset
// library to render a tree per origin.
export async function adaptationsOf(rootAssetId: string): Promise<LineageNode[]> {
  // BFS through the graph. Each iteration loads one generation; we cap
  // depth at 4 (DK → SE → NO → DE is a realistic ceiling).
  const out: LineageNode[] = [];
  let frontier: string[] = [rootAssetId];
  for (let depth = 0; depth < 4 && frontier.length > 0; depth += 1) {
    const children = await prisma.contentAsset.findMany({
      where: { sourceAssetId: { in: frontier } },
      select: {
        id: true,
        version: true,
        status: true,
        articleId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    out.push(...children);
    frontier = children.map((c) => c.id);
  }
  return out;
}

// Heuristic adaptation-rate signal: if the new draft has a sourceAssetId,
// the desk's billing helper should look at the *source's* original cost
// and price the adaptation at a fraction. We don't enforce the fraction
// here — quote-building owns pricing — but we expose the source ID +
// some metadata so the quote builder can reason about it.
export async function adaptationContext(assetId: string): Promise<{
  isAdaptation: boolean;
  sourceAssetId: string | null;
  rootAssetId: string | null;
}> {
  const row = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: { sourceAssetId: true },
  });
  if (!row?.sourceAssetId) {
    return { isAdaptation: false, sourceAssetId: null, rootAssetId: null };
  }
  const rootId = await rootOf(row.sourceAssetId);
  return {
    isAdaptation: true,
    sourceAssetId: row.sourceAssetId,
    rootAssetId: rootId,
  };
}
