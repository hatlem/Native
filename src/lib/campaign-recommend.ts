// Catalog-grounded brief recommender for the guided campaign flow.
//
// Same hybrid matcher the /plan empty-state uses (deterministic taxonomy +
// optional LLM enrichment), but packaged as one reusable call so the Discover
// step and /plan share a single source of truth. Grounded: only ranks active,
// bookable titles in the chosen market, so — unlike a free-associating LLM —
// it never surfaces an off-market or irrelevant title.

import { MarketCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import { indicativeFromRules, toRateRules } from "@/lib/money";
import {
  extractFacets,
  mergeFacets,
  matchTitles,
  facetsAreEmpty,
  type MatchableTitle,
} from "@/lib/brief-match";
import { enrichBriefWithLLM, llmEnrichmentAvailable } from "@/lib/brief-match-llm";
import {
  recommendTiered,
  type Candidate,
  type SupplementaryTitle,
} from "@/lib/recommend";

export type CampaignRecommendation = {
  picks: Candidate[];
  supplementary: SupplementaryTitle[];
  currency: string;
  // True when results were ranked by the brief (drives the rationale line);
  // false = plain budget/reach recommender fallback.
  briefMatched: boolean;
};

const MAX_PICKS = 12;
const BRIEF_MAX = 2000;

export async function recommendForBrief(input: {
  market: string;
  budget?: number;
  brief?: string;
}): Promise<CampaignRecommendation> {
  const budget = input.budget && input.budget > 0 ? input.budget : 0;
  const brief = (input.brief ?? "").slice(0, BRIEF_MAX);

  const recProducts = await prisma.product.findMany({
    where: {
      active: true,
      bookable: true,
      title: { active: true, market: { code: input.market as MarketCode } },
    },
    include: {
      title: {
        include: {
          publisher: { select: { pricesPublic: true } },
          market: { select: { currency: true } },
        },
      },
      priceRules: true,
    },
  });

  const currency = recProducts[0]?.currency ?? "EUR";
  const priced: Candidate[] = [];
  const unpricedByTitle = new Map<string, SupplementaryTitle>();

  for (const p of recProducts) {
    const reach = p.title.digitalReach ?? p.title.monthlyReach ?? 0;
    const cur = p.currency ?? p.title.market?.currency ?? "EUR";
    if (isProductPriceShown(p, p.title)) {
      priced.push({
        productId: p.id,
        titleId: p.titleId,
        titleName: p.title.name,
        category: p.title.category,
        type: p.type,
        reach,
        unitPrice: indicativeFromRules(Number(p.basePrice), toRateRules(p.priceRules)),
      });
    } else if (!unpricedByTitle.has(p.titleId)) {
      unpricedByTitle.set(p.titleId, {
        titleId: p.titleId,
        titleName: p.title.name,
        productId: p.id,
        reach,
        currency: cur,
      });
    }
  }

  let facets = brief ? extractFacets(brief) : null;
  if (facets && llmEnrichmentAvailable()) {
    facets = mergeFacets(facets, await enrichBriefWithLLM(brief));
  }

  if (facets && !facetsAreEmpty(facets)) {
    const matchables = new Map<string, MatchableTitle>();
    for (const p of recProducts) {
      if (matchables.has(p.titleId)) continue;
      matchables.set(p.titleId, {
        id: p.titleId,
        name: p.title.name,
        b2bB2c: p.title.b2bB2c,
        vertical: p.title.vertical,
        audience: p.title.audience,
        category: p.title.category,
        reach: p.title.reach,
        nativeFit: p.title.nativeFit,
        tags: p.title.tags,
        locationNote: p.title.locationNote,
        digitalReach: p.title.digitalReach,
        monthlyReach: p.title.monthlyReach,
      });
    }
    const matches = matchTitles([...matchables.values()], facets);
    const rank = new Map(matches.map((m, i) => [m.title.id, i]));
    const reasonsByTitle = new Map(matches.map((m) => [m.title.id, m.reasons]));

    const matchedPriced = priced
      .filter((c) => rank.has(c.titleId))
      .sort((a, b) => rank.get(a.titleId)! - rank.get(b.titleId)!)
      .map((c) => ({ ...c, reasons: reasonsByTitle.get(c.titleId) ?? [] }));

    const cap = budget > 0 ? budget : Number.MAX_SAFE_INTEGER;
    const picks: Candidate[] = [];
    let spend = 0;
    for (const c of matchedPriced) {
      if (picks.length >= MAX_PICKS) break;
      if (spend + c.unitPrice > cap) continue;
      picks.push(c);
      spend += c.unitPrice;
    }

    const supplementary = [...unpricedByTitle.values()]
      .filter((s) => rank.has(s.titleId))
      .sort((a, b) => rank.get(a.titleId)! - rank.get(b.titleId)!)
      .slice(0, 6);

    return { picks, supplementary, currency, briefMatched: true };
  }

  const rec = recommendTiered(
    priced,
    [...unpricedByTitle.values()],
    budget > 0 ? budget : Number.MAX_SAFE_INTEGER,
  );
  return { picks: rec.picks, supplementary: rec.supplementary, currency, briefMatched: false };
}

// Pure: turn raw facet reason keys (["B2B","finance","oslo"]) into a readable
// one-line rationale ("B2B · Finance · Oslo"). Short codes upcased, words
// title-cased, de-duplicated, capped so a broad brief stays legible.
export function summarizeReasons(reasons: string[] | undefined): string {
  if (!reasons || reasons.length === 0) return "";
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const raw of reasons) {
    const r = raw.trim();
    if (!r) continue;
    const label = r.length <= 3 ? r.toUpperCase() : r[0].toUpperCase() + r.slice(1);
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(label);
    if (parts.length >= 5) break;
  }
  return parts.join(" · ");
}
