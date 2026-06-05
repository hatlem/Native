import type { MetricsSource } from "@prisma/client";

// Higher rank wins. A new value may overwrite an existing one only when the
// incoming source rank >= the existing source rank. A desk override therefore
// never gets clobbered by a later form/email write; an AI email never clobbers
// a form value; same-source writes take the latest reading.
const RANK: Record<MetricsSource, number> = {
  PUBLISHER_EMAIL: 1,
  PUBLISHER: 2,       // legacy = same trust as a form submission
  PUBLISHER_FORM: 2,
  DESK: 3,
};

export function canOverwrite(incoming: MetricsSource, existing: MetricsSource | null): boolean {
  if (existing === null) return true;
  return RANK[incoming] >= RANK[existing];
}

export function buildFreezeSnapshot(
  current: { impressions: number | null },
  firstPartyClicks: number,
  now: Date,
): { frozenAt: Date; impressionsAtClose: number | null; clicksFirstPartyAtClose: number } {
  return {
    frozenAt: now,
    impressionsAtClose: current.impressions,
    clicksFirstPartyAtClose: firstPartyClicks,
  };
}
