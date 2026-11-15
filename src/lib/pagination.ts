// Offset pagination for server-rendered list pages, carried in the URL
// (?page=N) so a page of a long list is linkable and the back button works.

export type PageWindow = {
  page: number; // 1-based, clamped to [1, pageCount]
  pageCount: number;
  skip: number;
  take: number;
};

export function parsePageParam(raw: string | string[] | undefined): number {
  const n = parseInt(typeof raw === "string" ? raw : "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

// Clamp the requested page against the real total so ?page=999 lands on the
// last page instead of an empty table.
export function pageWindow(requested: number, total: number, pageSize: number): PageWindow {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(requested) || 1), pageCount);
  return { page, pageCount, skip: (page - 1) * pageSize, take: pageSize };
}

// Build an href that keeps the current filters/sort and swaps the page.
// Page 1 is the canonical URL without the parameter.
export function pageHref(
  basePath: string,
  params: Record<string, string | undefined>,
  page: number,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}
