export type LocalPartKind = "advertising" | "editorial" | "neutral";

export type CandidateHints = {
  isMailto: boolean;
  pathKind: "sales" | "contact" | "homepage" | "other";
  contextHasSalesVocab: boolean;
  hasName: boolean;
  emailDomainMatchesPublisher: boolean;
  // What the local part (before @) signals about the inbox's purpose.
  // The single strongest indicator of whether a mailbox actually handles
  // advertising — an `annonse@` is a buy, a `tips@` is a newsroom tip line.
  localPartKind: LocalPartKind;
};

export const SALES_VOCAB_RE = /(annonse|annonsering|annonsor|advert|sales|werben|werbung|mainos|mainonta)/i;

// Advertising / commercial inboxes — prefix match (forgiving) so e.g.
// `annonseavdelingen@`, `salgsavdeling@`, `marketing@` all qualify.
const ADVERTISING_LOCALPART_RE =
  /^(annons|annonce|salg|sales|advert|ads|adsales|market|marked|kommersiell|commercial|reklam|anzeige|anzeigen|werb|mediasal|mediaservice|mediekit|mediadaten|mediakort|mainos|myynti|ilmoitus)/i;

// Editorial / subscription / system inboxes — never the ad contact. Anchored
// (with optional .suffix) so we don't accidentally demote a person whose name
// merely starts with one of these strings.
const EDITORIAL_LOCALPART_RE =
  /^(tips|redaksjon|redaksjonen|redaktion|redaktionen|toimitus|debatt|debat|leserbrev|laeserbrev|insandare|insaendare|nyhet|nyheter|sport|sporten|kultur|abonnement|abonnent|prenumeration|prenumerera|tilaus|tilaukset|kundeservice|kundservice|kundsupport|asiakaspalvelu|kundecenter|kundecente|support|hjelp|faktura|fakturering|invoice|regnskap|okonomi|ekonomi|account|accounts|accounting|billing|jobb|jobs|stilling|karriere|career|rekruttering|recruitment|webmaster|webredaksjon|nettredaksjon|postmaster|noreply|no-reply|donotreply|do-not-reply|bounce|mailer-daemon)([._-].*)?$/i;

export function classifyLocalPart(email: string): LocalPartKind {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  if (ADVERTISING_LOCALPART_RE.test(local)) return "advertising";
  if (EDITORIAL_LOCALPART_RE.test(local)) return "editorial";
  return "neutral";
}

export function scoreCandidate(h: CandidateHints): number {
  let score = 0;
  if (h.isMailto) score += 40;
  if (h.pathKind === "sales") score += 25;
  if (h.contextHasSalesVocab) score += 15;
  if (h.hasName) score += 15;
  if (h.emailDomainMatchesPublisher) score += 10;
  // Local-part dominates: an advertising inbox is what we want; an editorial
  // inbox is actively wrong and must stay below the bulk-approve threshold
  // even when it sits on the ad page with a name attached.
  if (h.localPartKind === "advertising") score += 40;
  else if (h.localPartKind === "editorial") score -= 60;
  return Math.max(0, Math.min(100, score));
}
