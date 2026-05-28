export type CandidateHints = {
  isMailto: boolean;
  pathKind: "sales" | "contact" | "homepage" | "other";
  contextHasSalesVocab: boolean;
  hasName: boolean;
  emailDomainMatchesPublisher: boolean;
};

export function scoreCandidate(h: CandidateHints): number {
  let score = 0;
  if (h.isMailto) score += 50;
  if (h.pathKind === "sales") score += 30;
  if (h.contextHasSalesVocab) score += 20;
  if (h.hasName) score += 20;
  if (h.emailDomainMatchesPublisher) score += 10;
  return Math.max(0, Math.min(100, score));
}

export const SALES_VOCAB_RE = /(annonse|annonsering|annonsor|advert|sales|werben|werbung|mainos|mainonta)/i;
