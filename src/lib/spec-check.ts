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
// "Producerat för Hud & Glöd av NativeSpin redaktion" where the
// producer-credit suffix is per playbook).

import { countImages } from "@/lib/content/markdown";

export type SpecInput = {
  body: string;
  wordCountMin?: number | null;
  wordCountMax?: number | null;
  // The format's image minimum (Spec.imagesMin). Images are Markdown
  // ![caption](https://…) references in the draft, counted by the same
  // parser the review preview renders with.
  imagesMin?: number | null;
  titleDisclosure?: string | null;
  marketDisclosure?: string | null;
};

// One failed rule, structured so each surface can explain it in the
// reader's language (the writer portal localizes these); `issues` below
// keeps the English sentence form persisted to ArticlePlacement.specNotes.
// Failures block handing the draft over for review.
export type SpecFailure =
  | { rule: "disclosure"; label: string }
  | { rule: "tooShort"; words: number; min: number }
  | { rule: "tooLong"; words: number; max: number };

// A rule the draft misses that is reported but never blocks. The image
// minimum is one: the writer portal has no upload, images are only ever
// linked, and Spec.imagesMin defaults to 1, so as a gate it would hold
// back nearly every submission. It's shown with its reason so the writer
// (and the desk, via specNotes) can act on it.
export type SpecWarning = { rule: "tooFewImages"; images: number; min: number };

export type SpecResult = {
  // False only on failures; warnings never fail a draft.
  passed: boolean;
  words: number;
  issues: string[];
  failures: SpecFailure[];
  warnings: SpecWarning[];
  // English sentence form of `warnings`, like `issues`.
  warningNotes: string[];
};

export function describeSpecFailure(f: SpecFailure): string {
  switch (f.rule) {
    case "disclosure":
      return `Missing disclosure label "${f.label}"`;
    case "tooShort":
      return `Too short: ${f.words} < ${f.min} words`;
    case "tooLong":
      return `Too long: ${f.words} > ${f.max} words`;
  }
}

export function describeSpecWarning(w: SpecWarning): string {
  switch (w.rule) {
    case "tooFewImages":
      return `Too few images: ${w.images} < ${w.min}`;
  }
}

const IMAGE_MARKUP = /!\[[^\]\n]*\]\([^)\s]+\)/g;

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
  // Image markup isn't prose: "![Fleet at dawn](https://…)" shouldn't add
  // three words to the count.
  const prose = body.replace(IMAGE_MARKUP, " ").trim();
  const words = prose ? prose.split(/\s+/).length : 0;
  const images = countImages(body);
  const failures: SpecFailure[] = [];
  const warnings: SpecWarning[] = [];

  const requiredLabels = new Set<string>();
  if (input.titleDisclosure) requiredLabels.add(input.titleDisclosure);
  if (input.marketDisclosure) requiredLabels.add(input.marketDisclosure);

  for (const label of requiredLabels) {
    const matcher = labelMatcher(label);
    if (matcher && !matcher.test(body)) {
      failures.push({ rule: "disclosure", label });
    }
  }
  if (input.wordCountMin && words < input.wordCountMin) {
    failures.push({ rule: "tooShort", words, min: input.wordCountMin });
  }
  if (input.wordCountMax && words > input.wordCountMax) {
    failures.push({ rule: "tooLong", words, max: input.wordCountMax });
  }
  if (input.imagesMin && images < input.imagesMin) {
    warnings.push({ rule: "tooFewImages", images, min: input.imagesMin });
  }

  return {
    passed: failures.length === 0,
    words,
    issues: failures.map(describeSpecFailure),
    failures,
    warnings,
    warningNotes: warnings.map(describeSpecWarning),
  };
}
