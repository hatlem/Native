// Buyers (advertiser + agency audiences) who haven't dismissed/booked the
// help-call nudge see the catalog banner. Pure — keep DB/session out of here.
const BUYER_AUDIENCES = new Set(["advertiser", "agency"]);

export function shouldShowBookingBanner(input: {
  audience: string;
  dismissedAt: Date | null;
}): boolean {
  return BUYER_AUDIENCES.has(input.audience) && input.dismissedAt == null;
}
