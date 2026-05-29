import { extractCandidates } from "./extract";
import { scoreCandidate, type CandidateHints } from "./scoring";

export type FetchResponse = {
  ok: boolean;
  status: number;
  text: string;
  contentType: string;
};
export type Fetcher = (url: string) => Promise<FetchResponse>;

export type ScrapedCandidate = {
  email: string;
  name: string | null;
  role: string | null;
  phone: string | null;
  sourceUrl: string;
  confidence: number;
  hints: CandidateHints;
};

export type ScrapeResult = {
  publisherId: string;
  candidates: ScrapedCandidate[];
  errors: Array<{ url: string; reason: string }>;
};

const PATHS_BY_COUNTRY: Record<string, string[]> = {
  NO: ["/", "/annonsere", "/annonsorer", "/annonsering", "/for-annonsorer", "/mediekit", "/kontakt", "/om-oss"],
  SE: ["/", "/annonsera", "/annonsorer", "/annonsering", "/for-annonsorer", "/mediekit", "/kontakt", "/om-oss"],
  DK: ["/", "/annoncere", "/annoncorer", "/for-annoncorer", "/mediekit", "/kontakt", "/om-os"],
  FI: ["/", "/mainosta", "/mainonta", "/mediakortti", "/yhteystiedot", "/yhteys"],
  DE: ["/", "/werben", "/anzeigen", "/mediadaten", "/kontakt", "/impressum"],
  AT: ["/", "/werben", "/mediadaten", "/kontakt", "/impressum"],
  CH: ["/", "/werben", "/mediadaten", "/kontakt", "/impressum"],
  UK: ["/", "/advertise", "/advertising", "/advertise-with-us", "/media-pack", "/contact", "/contact-us"],
  IE: ["/", "/advertise", "/advertising", "/advertise-with-us", "/media-pack", "/contact", "/contact-us"],
};

export function pathsForCountry(country: string): string[] {
  return PATHS_BY_COUNTRY[country] ?? PATHS_BY_COUNTRY["UK"];
}

function pathKindFor(path: string): CandidateHints["pathKind"] {
  if (path === "/") return "homepage";
  if (/annons|annonc|advert|werben|anzeigen|mainos|mediekit|mediadaten|mediakort|media-pack/i.test(path)) return "sales";
  if (/kontakt|contact|impressum|yhteys|om-oss|om-os/i.test(path)) return "contact";
  return "other";
}

export async function scrapePublisher(args: {
  publisherId: string;
  rootUrl: string;
  countryCode: string;
  fetcher: Fetcher;
}): Promise<ScrapeResult> {
  const root = args.rootUrl.replace(/\/+$/, "");
  const publisherDomain = new URL(root).hostname.replace(/^(www\.)+/, "");
  const seen = new Map<string, ScrapedCandidate>();
  const errors: ScrapeResult["errors"] = [];

  for (const path of pathsForCountry(args.countryCode)) {
    const url = root + path;
    let res: FetchResponse;
    try {
      res = await args.fetcher(url);
    } catch (err) {
      errors.push({ url, reason: `fetch_throw:${(err as Error).message}` });
      continue;
    }
    if (!res.ok) {
      errors.push({ url, reason: `http_${res.status}` });
      continue;
    }
    if (!res.contentType.toLowerCase().includes("html")) {
      errors.push({ url, reason: `non_html:${res.contentType}` });
      continue;
    }

    const pathKind = pathKindFor(path);
    const extracted = extractCandidates({
      html: res.text,
      sourceUrl: url,
      pathKind,
      publisherDomain,
    });
    for (const c of extracted) {
      const score = scoreCandidate(c.hints);
      const existing = seen.get(c.email);
      if (!existing || existing.confidence < score) {
        seen.set(c.email, {
          email: c.email,
          name: c.name,
          role: c.role,
          phone: c.phone,
          sourceUrl: url,
          confidence: score,
          hints: c.hints,
        });
      }
    }
  }

  const candidates = Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
  return { publisherId: args.publisherId, candidates, errors };
}
