// Curated campaign audience segments, distilled from the Title.audience
// taxonomy. These describe the editorial audience a buyer wants to reach
// (used by the desk to pick titles) — NOT user-level ad-targeting data.
export const AUDIENCE_SEGMENTS = [
  "general-consumer",
  "regional-local",
  "affluent",
  "families-parents",
  "seniors-50plus",
  "b2b-decision-makers",
  "healthcare-pros",
  "legal-finance-pros",
  "tech-it-pros",
  "construction-property-pros",
  "farming-rural",
  "lifestyle-hobby",
  "culture-media",
] as const;

export type AudienceSegment = (typeof AUDIENCE_SEGMENTS)[number];

export function isAudienceSegment(v: string): v is AudienceSegment {
  return (AUDIENCE_SEGMENTS as readonly string[]).includes(v);
}
