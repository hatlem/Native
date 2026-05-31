// Pure helpers for in-article tracked links. No DB, no IO.

const HREF_RE = /href\s*=\s*"(https?:\/\/[^"]+)"/gi;

// Distinct external http(s) URLs in the asset body, in first-seen order.
export function extractLinks(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(HREF_RE)) {
    const url = m[1]!;
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

export function goPath(token: string): string {
  return `/go/${token}`;
}

// Replace each mapped URL's href with its /go/<token> path. Unmapped
// hrefs are left untouched. URLs are matched exactly (as they appear in
// an href="..."), so partial/substring collisions can't occur.
export function rewriteBodyLinks(
  body: string,
  urlToToken: Record<string, string>,
): string {
  return body.replace(HREF_RE, (whole, url: string) =>
    urlToToken[url] ? `href="${goPath(urlToToken[url])}"` : whole,
  );
}
