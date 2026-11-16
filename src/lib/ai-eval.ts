// Scoring for the brief → facets golden set (scripts/eval-brief-match.ts).
// Pure, so the scoring rule itself is unit-tested without calling a model.

import type { BriefFacets } from "@/lib/brief-match";

export type FacetExpectation = {
  audienceType?: "B2B" | "B2C";
  industries?: string[];
  geoScopes?: string[];
  locations?: string[];
};

export type EvalCase = {
  id: string;
  brief: string;
  // Every listed value must be present in the extraction.
  expected: FacetExpectation;
  // None of the listed values may be present.
  forbidden?: FacetExpectation;
};

export type EvalCaseResult = { id: string; pass: boolean; missing: string[]; unexpected: string[] };

const LIST_KEYS = ["industries", "geoScopes", "locations"] as const;

function has(list: string[] | undefined, value: string): boolean {
  return (list ?? []).some((v) => v.toLowerCase() === value.toLowerCase());
}

export function scoreEvalCase(c: EvalCase, got: Partial<BriefFacets>): EvalCaseResult {
  const missing: string[] = [];
  const unexpected: string[] = [];

  if (c.expected.audienceType && got.audienceType !== c.expected.audienceType) {
    missing.push(`audienceType=${c.expected.audienceType}`);
  }
  if (c.forbidden?.audienceType && got.audienceType === c.forbidden.audienceType) {
    unexpected.push(`audienceType=${c.forbidden.audienceType}`);
  }
  for (const key of LIST_KEYS) {
    for (const want of c.expected[key] ?? []) {
      if (!has(got[key] as string[] | undefined, want)) missing.push(`${key}:${want}`);
    }
    for (const bad of c.forbidden?.[key] ?? []) {
      if (has(got[key] as string[] | undefined, bad)) unexpected.push(`${key}:${bad}`);
    }
  }
  return { id: c.id, pass: missing.length === 0 && unexpected.length === 0, missing, unexpected };
}

export function evalSummary(results: EvalCaseResult[]): { passed: number; total: number; rate: number } {
  const passed = results.filter((r) => r.pass).length;
  return { passed, total: results.length, rate: results.length ? passed / results.length : 0 };
}
