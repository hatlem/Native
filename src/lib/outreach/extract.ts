import * as cheerio from "cheerio";
import { SALES_VOCAB_RE, type CandidateHints } from "./scoring";

export type ExtractedCandidate = {
  email: string;
  name: string | null;
  role: string | null;
  phone: string | null;
  hints: CandidateHints;
};

export type ExtractArgs = {
  html: string;
  sourceUrl: string;
  pathKind: CandidateHints["pathKind"];
  publisherDomain: string;
};

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const EMAIL_SINGLE_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/;

export function extractCandidates(args: ExtractArgs): ExtractedCandidate[] {
  const $ = cheerio.load(args.html);
  const found = new Map<string, ExtractedCandidate>();

  // Pass 1: mailto: links (highest signal)
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const email = href.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
    if (!email || !EMAIL_SINGLE_RE.test(email)) return;
    const { name, role } = inferNameAndRole($, el);
    const surroundingText = $(el).closest("p, li, dd, dt, td, tr, section, div").first().text();
    const hints: CandidateHints = {
      isMailto: true,
      pathKind: args.pathKind,
      contextHasSalesVocab: SALES_VOCAB_RE.test(surroundingText),
      hasName: !!name,
      emailDomainMatchesPublisher: email.endsWith("@" + args.publisherDomain),
    };
    found.set(email, {
      email,
      name,
      role,
      phone: extractNearbyPhone($, el),
      hints,
    });
  });

  // Pass 2: scrape plain-text emails within sales-vocab nodes only.
  // Check each candidate element AND its containing row/block for sales vocab,
  // so that a <td> with an email benefits from a sibling <th>Sales Director</th>.
  $("p, li, dd, dt, td, address").each((_, el) => {
    const $el = $(el);
    const ownText = $el.text();
    // Use own text OR the closest row/list-item text for vocab match
    const contextText = $el.closest("tr, dl, ul, ol").text() || ownText;
    if (!SALES_VOCAB_RE.test(contextText)) return;
    const matches = ownText.match(EMAIL_RE);
    if (!matches) return;
    for (const raw of matches) {
      const email = raw.toLowerCase();
      if (found.has(email)) continue;
      const { name, role } = inferNameAndRole($, el);
      const hints: CandidateHints = {
        isMailto: false,
        pathKind: args.pathKind,
        contextHasSalesVocab: true,
        hasName: !!name,
        emailDomainMatchesPublisher: email.endsWith("@" + args.publisherDomain),
      };
      found.set(email, {
        email,
        name,
        role,
        phone: extractNearbyPhone($, el),
        hints,
      });
    }
  });

  return Array.from(found.values());
}

function inferNameAndRole(
  $: cheerio.CheerioAPI,
  el: cheerio.AnyNode,
): { name: string | null; role: string | null } {
  const $el = $(el);

  // <dt>Salgssjef Ola Nordmann</dt><dd>email</dd>
  const dt = $el.closest("dd").prevAll("dt").first();
  if (dt.length) {
    const txt = dt.text().trim();
    return splitRoleAndName(txt);
  }

  // <tr><th>Sales Director</th><td>Kari Hansen</td><td>email</td></tr>
  const tr = $el.closest("tr");
  if (tr.length) {
    const cells = tr
      .find("th, td")
      .map((_, c) => $(c).text().trim())
      .get();
    if (cells.length >= 3) return { role: cells[0] || null, name: cells[1] || null };
  }

  // Fallback: nearest preceding heading
  const heading = $el.parentsUntil("body").find("h1, h2, h3, h4, h5, h6").last();
  if (heading.length) {
    return splitRoleAndName(heading.text().trim());
  }

  return { name: null, role: null };
}

function splitRoleAndName(s: string): { name: string | null; role: string | null } {
  if (!s) return { name: null, role: null };
  // Keep the full string in `name`; role parsing is noisy for Nordic titles.
  return { name: s, role: null };
}

function extractNearbyPhone($: cheerio.CheerioAPI, el: cheerio.AnyNode): string | null {
  const txt = $(el).closest("dd, li, p, tr, address").text();
  const m = txt.match(PHONE_RE);
  return m ? m[0].trim() : null;
}
