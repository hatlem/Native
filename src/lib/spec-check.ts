// Pure spec-check used by the desk's runSpecCheck action. Extracted so
// it can be unit-tested and so the per-market disclosure rule
// (PLAN §13) lives in one place: a Title-level label wins, but the
// market's default label is enforced as a minimum even when the
// Title hasn't configured its own.

export type SpecInput = {
  body: string;
  wordCountMin?: number | null;
  wordCountMax?: number | null;
  titleDisclosure?: string | null;
  marketDisclosure?: string | null;
};

export type SpecResult = { passed: boolean; words: number; issues: string[] };

export function specCheck(input: SpecInput): SpecResult {
  const body = (input.body ?? "").trim();
  const words = body ? body.split(/\s+/).length : 0;
  const issues: string[] = [];

  const requiredLabels = new Set<string>();
  if (input.titleDisclosure) requiredLabels.add(input.titleDisclosure);
  if (input.marketDisclosure) requiredLabels.add(input.marketDisclosure);

  for (const label of requiredLabels) {
    const ok = body.toLowerCase().includes(label.toLowerCase());
    if (!ok) issues.push(`Missing disclosure label "${label}"`);
  }
  if (input.wordCountMin && words < input.wordCountMin) {
    issues.push(`Too short: ${words} < ${input.wordCountMin} words`);
  }
  if (input.wordCountMax && words > input.wordCountMax) {
    issues.push(`Too long: ${words} > ${input.wordCountMax} words`);
  }

  return { passed: issues.length === 0, words, issues };
}
