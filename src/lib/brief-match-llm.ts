// Optional LLM enrichment for the brief matcher (the "hybrid" half).
//
// The deterministic taxonomy in brief-match.ts only knows the vocabulary we
// curated. This sends the brief to Claude (claude-sonnet-4-6) to catch
// phrasing the taxonomy misses and to expand to related terms, returning the
// same Partial<BriefFacets> shape that mergeFacets() folds in.
//
// Strictly optional and fail-open: with no gateway key, on timeout, or on any
// error/parse failure it returns {} so matching runs deterministic-only. It
// never throws to the caller.

import type { BriefFacets, GeoScope } from "@/lib/brief-match";
import { gatewayChat, gatewayConfigured } from "@/lib/gateway-chat";

const MODEL = "claude-sonnet-4-6";
const TIMEOUT_MS = 6000;

// Constrain the model to the closed facet vocabulary the catalog actually
// uses, so its output composes with the deterministic scorer.
const SYSTEM = `You extract advertising-audience facets from a marketing brief for a Nordic/European native-advertising marketplace. Return ONLY a compact JSON object, no prose, with this exact shape:
{"audienceType": "B2B" | "B2C" | null,
 "industries": string[],   // lowercase canonical keys from: finance, legal, health, fitness, agriculture, tech, marketing, retail, energy, education, auto, construction, sports, food, politics, charity
 "geoScopes": string[],    // any of: National, Regional, Local, International
 "locations": string[],    // lowercase city/region names mentioned or strongly implied
 "keywords": string[]}     // up to 6 extra lowercase single-word topics
Infer related terms (e.g. "we sell software to enterprises" -> audienceType B2B, industries ["tech"]). Use null/[] when unsure. Output JSON only.`;

type RawFacets = {
  audienceType?: unknown;
  industries?: unknown;
  geoScopes?: unknown;
  locations?: unknown;
  keywords?: unknown;
};

const VALID_INDUSTRIES = new Set([
  "finance", "legal", "health", "fitness", "agriculture", "tech", "marketing",
  "retail", "energy", "education", "auto", "construction", "sports", "food",
  "politics", "charity",
]);
const VALID_SCOPES = new Set(["National", "Regional", "Local", "International"]);

function strArray(v: unknown, max: number, lower = true): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => (lower ? s.toLowerCase() : s).trim())
    .filter(Boolean)
    .slice(0, max);
}

// Coerce arbitrary model output into a safe Partial<BriefFacets>.
export function sanitizeLlmFacets(raw: RawFacets): Partial<BriefFacets> {
  const audienceType =
    raw.audienceType === "B2B" || raw.audienceType === "B2C" ? raw.audienceType : null;
  const industries = strArray(raw.industries, 8).filter((s) => VALID_INDUSTRIES.has(s));
  const geoScopes = strArray(raw.geoScopes, 4, false)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .filter((s) => VALID_SCOPES.has(s)) as GeoScope[];
  const locations = strArray(raw.locations, 8);
  const keywords = strArray(raw.keywords, 6);
  return { audienceType, industries, geoScopes, locations, keywords };
}

export function llmEnrichmentAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return gatewayConfigured(env);
}

export async function enrichBriefWithLLM(brief: string): Promise<Partial<BriefFacets>> {
  if (!brief.trim()) return {};

  const result = await gatewayChat({
    entityId: "nativespin-system",
    model: MODEL,
    system: SYSTEM,
    messages: [{ role: "user", content: brief.slice(0, 2000) }],
    maxTokens: 400,
    timeoutMs: TIMEOUT_MS,
  });
  if (!result) return {}; // fail-open: deterministic-only

  const json = extractJson(result.text);
  if (!json) return {};
  return sanitizeLlmFacets(json);
}

// Pull the first JSON object out of the model's text, tolerating stray prose
// or code fences.
export function extractJson(text: string): RawFacets | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as RawFacets;
  } catch {
    return null;
  }
}
