// The time window of the desk report, carried in the URL so a view can be
// shared: ?period=30d|90d|12m|ytd|all, or ?from=YYYY-MM-DD&to=YYYY-MM-DD
// (both inclusive, UTC days). Default: the last 12 months.

export const REPORT_PERIOD_PRESETS = ["30d", "90d", "12m", "ytd", "all"] as const;
export type ReportPeriodPreset = (typeof REPORT_PERIOD_PRESETS)[number];
export const DEFAULT_REPORT_PERIOD: ReportPeriodPreset = "12m";

export type ReportPeriod = {
  // "custom" when from/to were given.
  preset: ReportPeriodPreset | "custom";
  // Inclusive lower bound; null = no lower bound ("all").
  from: Date | null;
  // Exclusive upper bound; null = no upper bound (everything up to now).
  to: Date | null;
};

function one(v: string | string[] | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseDay(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  // Reject 2026-02-31 rolling over into March.
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? null : d;
}

const DAY_MS = 86_400_000;

export function parseReportPeriod(
  sp: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): ReportPeriod {
  const from = parseDay(one(sp.from));
  const to = parseDay(one(sp.to));
  if (from || to) {
    // A reversed range is read as the two days swapped, not as empty.
    const [a, b] = from && to && from > to ? [to, from] : [from, to];
    return { preset: "custom", from: a, to: b ? new Date(b.getTime() + DAY_MS) : null };
  }
  const raw = one(sp.period);
  const preset = (REPORT_PERIOD_PRESETS as readonly string[]).includes(raw)
    ? (raw as ReportPeriodPreset)
    : DEFAULT_REPORT_PERIOD;
  switch (preset) {
    case "30d":
      return { preset, from: new Date(now.getTime() - 30 * DAY_MS), to: null };
    case "90d":
      return { preset, from: new Date(now.getTime() - 90 * DAY_MS), to: null };
    case "12m": {
      const d = new Date(now);
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      return { preset, from: d, to: null };
    }
    case "ytd":
      return { preset, from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to: null };
    case "all":
      return { preset, from: null, to: null };
  }
}

// The inclusive last day of a custom range, for the date input's value.
export function periodInputDays(p: ReportPeriod): { from: string; to: string } {
  if (p.preset !== "custom") return { from: "", to: "" };
  return {
    from: p.from ? p.from.toISOString().slice(0, 10) : "",
    to: p.to ? new Date(p.to.getTime() - DAY_MS).toISOString().slice(0, 10) : "",
  };
}

// A Prisma `createdAt` filter for the window (undefined = unbounded).
export function periodDateFilter(p: ReportPeriod): { gte?: Date; lt?: Date } | undefined {
  if (!p.from && !p.to) return undefined;
  return { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lt: p.to } : {}) };
}
