// URL state for the desk request queue (/desk/requests): status filter,
// free-text search and page all live in the query string so any view of the
// queue is a shareable link.

export const DESK_REQUESTS_PAGE_SIZE = 25;

// DRAFT is the buyer's unsent plan — never a desk concern.
export const DESK_REQUEST_STATUSES = ["SUBMITTED", "IN_REVIEW", "QUOTED", "CLOSED"] as const;
export type DeskRequestStatusFilter = "open" | "all" | (typeof DESK_REQUEST_STATUSES)[number];

export type DeskRequestsQuery = {
  q: string;
  status: DeskRequestStatusFilter;
  page: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

function str(sp: SearchParams, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v.trim() : "";
}

export function parseDeskRequestsQuery(sp: SearchParams): DeskRequestsQuery {
  const rawStatus = str(sp, "status");
  const status: DeskRequestStatusFilter =
    rawStatus === "all" || (DESK_REQUEST_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as DeskRequestStatusFilter)
      : "open";
  const pageParam = parseInt(str(sp, "page") || "1", 10);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? Math.min(pageParam, 10_000) : 1;
  return { q: str(sp, "q").slice(0, 100), status, page };
}

export function deskRequestsHref(query: Partial<DeskRequestsQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status && query.status !== "open") params.set("status", query.status);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const qs = params.toString();
  return `/desk/requests${qs ? `?${qs}` : ""}`;
}
