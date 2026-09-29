// Canonical addresses for a plan. Every plan has its own URL, /plan/<listId>,
// so it can be bookmarked, shared with a colleague and told apart from the
// others in the address bar; /plan alone just forwards to the active plan.

type SearchParams = Record<string, string | string[] | undefined>;

/** Rebuild a query string, keeping repeated keys and dropping empty ones. */
export function toQueryString(sp: SearchParams | undefined, omit: readonly string[] = []): string {
  if (!sp) return "";
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (omit.includes(key) || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) qs.append(key, v);
  }
  const out = qs.toString();
  return out ? `?${out}` : "";
}

/** /{locale}/plan/{listId}, or /{locale}/plan when there is no list yet. */
export function planPath(locale: string, listId?: string | null, sp?: SearchParams): string {
  const base = listId ? `/${locale}/plan/${encodeURIComponent(listId)}` : `/${locale}/plan`;
  return base + toQueryString(sp);
}

/** Route through /plan/open, which makes `listId` the active list (the cookie
 *  every plan action reads) before landing on its canonical address. */
export function openPlanPath(locale: string, listId: string, sp?: SearchParams): string {
  return `/${locale}/plan/open` + toQueryString({ ...sp, list: listId });
}
