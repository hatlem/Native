// Pure spec-check used by the desk's runSpecCheck action. Extracted so
// it can be unit-tested and so the per-market disclosure rule
// (PLAN §13) lives in one place: a Title-level label wins, but the
// market's default label is enforced as a minimum even when the
// Title hasn't configured its own.
//
// Label templates can carry placeholder tokens (e.g.
//   "Producerat för [SPONSOR]"
//   "Annoncørbetalt indhold — {PUBLISHER}"
// ). The placeholder is treated as a wildcard so a writer can fill it
// with the actual sponsor name (Liv's gap from the scenario coverage
// matrix: the spec-check used to reject any byline that didn't match
// the template verbatim, including legitimate variants like
// "Producerat för Hud & Glöd av ATNative redaktion" where the
// producer-credit suffix is per playbook).

export type SpecInput = {
  body: string;
  wordCountMin?: number | null;
  wordCountMax?: number | null;
  titleDisclosure?: string | null;
  marketDisclosure?: string | null;
};

export type SpecResult = { passed: boolean; words: number; issues: string[] };

// Tokens we treat as "fill-this-in" placeholders. Both square-bracket
// and curly-brace conventions are recognised so neither publisher
// configuration habit produces silent false-fails.
const PLACEHOLDER_RE = /\[(SPONSOR|PUBLISHER|PRODUCER|BRAND)\]|\{(SPONSOR|PUBLISHER|PRODUCER|BRAND)\}/gi;

// Escape regex metacharacters so the literal portions of a template
// don't get reinterpreted (e.g. a publisher using "(reklame)" in a
// label).
function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Turn a label template into a case-insensitive matcher.
//   "Annonse"                          → /annonse/i  (substring match)
//   "Producerat för [SPONSOR]"         → /producerat\s+för\s+.+?/i
//   "Annoncørbetalt indhold — {PUB}"   → handled the same
// Returns null when the label is empty.
export function labelMatcher(label: string | null | undefined): RegExp | null {
  if (!label) return null;
  const hasPlaceholder = PLACEHOLDER_RE.test(label);
  PLACEHOLDER_RE.lastIndex = 0;
  if (!hasPlaceholder) {
    // Backwards compatible: substring/case-insensitive match for any
    // plain label (Annonse, Annons, Annoncørbetalt indhold, etc.).
    return new RegExp(escapeRegex(label), "i");
  }
  // Build a regex from the template: escape literals, replace any
  // placeholder token with a non-greedy wildcard (at least one
  // non-whitespace character so an empty sponsor doesn't sneak past).
  const pieces = label.split(PLACEHOLDER_RE).filter((s) => s !== undefined);
  // .split with capture groups interleaves text + token-name pieces;
  // we don't care which token was used — they're all wildcards.
  const literals = pieces.filter((_, i) => i % 3 === 0); // groups: text, token1, token2
  let pattern = "";
  for (let i = 0; i < literals.length; i += 1) {
    pattern += escapeRegex(literals[i]);
    if (i < literals.length - 1) pattern += "\\S[\\S\\s]*?"; // at least 1 char
  }
  return new RegExp(pattern, "i");
}

export function specCheck(input: SpecInput): SpecResult {
  const body = (input.body ?? "").trim();
  const words = body ? body.split(/\s+/).length : 0;
  const issues: string[] = [];

  const requiredLabels = new Set<string>();
  if (input.titleDisclosure) requiredLabels.add(input.titleDisclosure);
  if (input.marketDisclosure) requiredLabels.add(input.marketDisclosure);

  for (const label of requiredLabels) {
    const matcher = labelMatcher(label);
    if (matcher && !matcher.test(body)) {
      issues.push(`Missing disclosure label "${label}"`);
    }
  }
  if (input.wordCountMin && words < input.wordCountMin) {
    issues.push(`Too short: ${words} < ${input.wordCountMin} words`);
  }
  if (input.wordCountMax && words > input.wordCountMax) {
    issues.push(`Too long: ${words} > ${input.wordCountMax} words`);
  }

  return { passed: issues.length === 0, words, issues };
}
