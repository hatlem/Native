// Lead time as buyers see it on the catalog surfaces (title detail, compare).
// A publisher-stated lead time wins; without one we show an honest platform
// estimate, labelled as such — never a bare "—" on one surface and "about 10
// days" on another for the same title.

export const ESTIMATED_LEAD_TIME_DAYS = 10;

export type LeadTime = { days: number; estimated: boolean };

// One product's lead time.
export function productLeadTime(leadTimeDays: number | null): LeadTime {
  return leadTimeDays != null
    ? { days: leadTimeDays, estimated: false }
    : { days: ESTIMATED_LEAD_TIME_DAYS, estimated: true };
}

// A title's lead time: the fastest publisher-stated one across its products,
// else the platform estimate.
export function titleLeadTime(products: { leadTimeDays: number | null }[]): LeadTime {
  const stated = products.map((p) => p.leadTimeDays).filter((d): d is number => d != null);
  return stated.length ? { days: Math.min(...stated), estimated: false } : productLeadTime(null);
}
