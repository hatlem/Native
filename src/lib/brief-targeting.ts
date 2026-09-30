// A request's targeting (geography, audience segments, editorial context)
// lives in structured Plan columns and renders with localized labels
// (BriefTargeting). It used to be folded into Request.briefSummary as English
// "Geo: … / Audience: b2b-decision-makers,… / Context: …" lines, so the
// buyer and the desk read raw segment keys. Pure, for unit tests.

import { isAudienceSegment, type AudienceSegment } from "@/lib/targeting/segments";

export type PlanTargeting = {
  targetGeo: string | null;
  targetAudience: string | null;
  targetContext: string | null;
};

export type BriefTargetingView = {
  geo: string | null;
  audience: AudienceSegment[];
  context: string | null;
};

/** The targeting worth showing: trimmed text, known segments only. Null when
 *  the plan has none. */
export function briefTargeting(plan: PlanTargeting): BriefTargetingView | null {
  const geo = plan.targetGeo?.trim() || null;
  const context = plan.targetContext?.trim() || null;
  const audience = (plan.targetAudience ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isAudienceSegment);
  return geo || context || audience.length ? { geo, audience, context } : null;
}

// The exact line prefixes the old fold wrote (firm-order.ts, submit-rfq.ts).
const FOLDED_LINE = /^(?:Geo|Audience|Context): /;

/** A summary written before the fold was removed, without its folded
 *  targeting lines, which now render from the Plan columns instead. Only
 *  the fold's own trailing lines go: a buyer's brief that merely mentions
 *  "Context:" mid-text keeps it. Null when nothing else is left. */
export function briefWithoutFoldedTargeting(summary: string | null): string | null {
  if (!summary) return null;
  const lines = summary.split("\n");
  while (lines.length && FOLDED_LINE.test(lines[lines.length - 1])) lines.pop();
  const rest = lines.join("\n").trim();
  return rest || null;
}
