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
  type TitleMatch,
} from "@/lib/brief-match";
import { enrichBriefWithLLM, llmEnrichmentAvailable } from "@/lib/brief-match-llm";
import { rerankBriefMatches, rerankAvailable } from "@/lib/brief-rerank-llm";
import { titleDisplayName } from "@/lib/title-display";
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
// Grounded-reason LLM rerank is run against the full deduped, brief-ranked
// pool (not just the post-budget picks) so supplementary titles can also
// carry a reason if they end up shown.
const RERANK_MAX_CANDIDATES = 30;

export async function recommendForBrief(input: {
  market: string;
  budget?: number;
  brief?: string;
  // Drives the language of the LLM rerank's grounded reasons. Defaults to
  // English when the caller (e.g. an older UI surface) doesn't pass one.
  locale?: string;
}): Promise<CampaignRecommendation> {
  const budget = input.budget && input.budget > 0 ? input.budget : 0;
  const brief = (input.brief ?? "").slice(0, BRIEF_MAX);
  const locale = input.locale ?? "en";

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
        titleName: titleDisplayName(p.title),
        category: p.title.category,
        type: p.type,
        reach,
        unitPrice: indicativeFromRules(Number(p.basePrice), toRateRules(p.priceRules)),
      });
    } else if (!unpricedByTitle.has(p.titleId)) {
      unpricedByTitle.set(p.titleId, {
        titleId: p.titleId,
        titleName: titleDisplayName(p.title),
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
        description: p.title.description,
        keywords: p.title.keywords,
        aliases: p.title.aliases,
        audienceNote: p.title.audienceNote,
        city: p.title.city,
        region: p.title.region,
      });
    }
    const matches = matchTitles([...matchables.values()], facets);
    const { picks, supplementary, matchedPriced } = pickBriefMatches(
      priced,
      [...unpricedByTitle.values()],
      matches,
      budget,
      { maxPicks: MAX_PICKS },
    );

    // Grounded per-title reasons (best-effort, fail-open): replaces the raw
    // facet-chip line with a natural-language sentence in the buyer's
    // locale. Never changes ranking — only annotates candidates that are
    // already in matchedPriced (picks share object references with it, so
    // mutating reasonText here is visible on the returned picks for free).
    if (brief && rerankAvailable()) {
      const productById = new Map(recProducts.map((p) => [p.id, p]));
      const top = matchedPriced.slice(0, RERANK_MAX_CANDIDATES);
      const reasonMap = await rerankBriefMatches(
        top.map((c) => {
          const mt = matchables.get(c.titleId);
          const product = productById.get(c.productId);
          return {
            titleId: c.titleId,
            name: c.titleName,
            vertical: mt?.vertical ?? null,
            audience: mt?.audience ?? null,
            category: c.category,
            description: mt?.description ?? null,
            keywords: mt?.keywords ?? [],
            includedText: product?.includedText ?? null,
          };
        }),
        locale,
        brief,
      );
      for (const c of top) {
        const reason = reasonMap.get(c.titleId);
        if (reason) c.reasonText = reason;
      }
    }

    return { picks, supplementary, currency, briefMatched: true };
  }

  const rec = recommendTiered(
    priced,
    [...unpricedByTitle.values()],
    budget > 0 ? budget : Number.MAX_SAFE_INTEGER,
  );
  return { picks: rec.picks, supplementary: rec.supplementary, currency, briefMatched: false };
}

export type BriefPickResult = {
  picks: Candidate[];
  supplementary: SupplementaryTitle[];
  // The full deduped (one product per title, cheapest), brief-ranked pool
  // this was picked from, before the budget cut — exposed so the LLM rerank
  // can ground reasons for more than just the final picks.
  matchedPriced: Candidate[];
};

// Pure: turn a brief-ranked title list + priced/unpriced candidates into a
// budget-capped set of picks, deduplicated so a title with several priced
// products (e.g. article + banner) surfaces once — the cheapest shown-price
// product for that title — instead of once per product.
export function pickBriefMatches(
  priced: Candidate[],
  unpriced: SupplementaryTitle[],
  matches: TitleMatch[],
  budget: number,
  opts: { maxPicks?: number; supplementaryCap?: number } = {},
): BriefPickResult {
  const maxPicks = opts.maxPicks ?? MAX_PICKS;
  const supplementaryCap = opts.supplementaryCap ?? 6;
  const rank = new Map(matches.map((m, i) => [m.title.id, i]));
  const reasonsByTitle = new Map(matches.map((m) => [m.title.id, m.reasons]));

  const cheapestByTitle = new Map<string, Candidate>();
  for (const c of priced) {
    if (!rank.has(c.titleId)) continue;
    const existing = cheapestByTitle.get(c.titleId);
    if (!existing || c.unitPrice < existing.unitPrice) cheapestByTitle.set(c.titleId, c);
  }
  const matchedPriced = [...cheapestByTitle.values()]
    .sort((a, b) => rank.get(a.titleId)! - rank.get(b.titleId)!)
    .map((c) => ({ ...c, reasons: reasonsByTitle.get(c.titleId) ?? [] }));

  const cap = budget > 0 ? budget : Number.MAX_SAFE_INTEGER;
  const picks: Candidate[] = [];
  // Defensive on top of the dedup above (matches recommend.ts's
  // recommendMix pattern) — belt-and-braces against a titleId somehow
  // appearing twice in matchedPriced.
  const usedTitles = new Set<string>();
  let spend = 0;
  for (const c of matchedPriced) {
    if (picks.length >= maxPicks) break;
    if (usedTitles.has(c.titleId)) continue;
    if (spend + c.unitPrice > cap) continue;
    picks.push(c);
    usedTitles.add(c.titleId);
    spend += c.unitPrice;
  }

  const supplementary = [...unpriced]
    .filter((s) => rank.has(s.titleId))
    .sort((a, b) => rank.get(a.titleId)! - rank.get(b.titleId)!)
    .slice(0, supplementaryCap);

  return { picks, supplementary, matchedPriced };
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
