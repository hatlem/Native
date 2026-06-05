import type {
  ContentLanguage,
  ContentTopic,
  LanguageProficiency,
} from "@prisma/client";

export type WriterForMatch = {
  active: boolean;
  maxActiveAssignments: number | null;
  activeAssignments: number; // computed by the caller (see capacity.ts)
  languages: { language: ContentLanguage; proficiency: LanguageProficiency }[];
  specialties: { topic: ContentTopic }[];
};

export type MatchCriteria = {
  language: ContentLanguage | null;
  topics: ContentTopic[];
};

export type MatchResult = {
  score: number;
  languageMatch: boolean;
  topicOverlap: number;
  overCapacity: boolean;
};

const PROFICIENCY_BONUS: Record<LanguageProficiency, number> = {
  NATIVE: 2,
  FLUENT: 1,
  WORKING: 0,
};

// Language is the dominant signal (100), then proficiency (×10), then each
// specialty overlap (5). Inactive writers sink far below everyone;
// over-capacity is a mild penalty. Nothing is ever filtered out — the desk
// always retains the final pick.
export function scoreWriter(
  writer: WriterForMatch,
  criteria: MatchCriteria,
): MatchResult {
  const langEntry = criteria.language
    ? writer.languages.find((l) => l.language === criteria.language)
    : undefined;
  const languageMatch = Boolean(langEntry);

  const topicOverlap = writer.specialties.filter((s) =>
    criteria.topics.includes(s.topic),
  ).length;

  const overCapacity =
    writer.maxActiveAssignments != null &&
    writer.activeAssignments >= writer.maxActiveAssignments;

  let score = 0;
  if (langEntry) score += 100 + PROFICIENCY_BONUS[langEntry.proficiency] * 10;
  score += topicOverlap * 5;
  if (!writer.active) score -= 1000;
  if (overCapacity) score -= 50;

  return { score, languageMatch, topicOverlap, overCapacity };
}

export function rankWriters<T extends WriterForMatch>(
  writers: T[],
  criteria: MatchCriteria,
): (T & { match: MatchResult })[] {
  return writers
    .map((w) => ({ ...w, match: scoreWriter(w, criteria) }))
    .sort((a, b) => b.match.score - a.match.score);
}
