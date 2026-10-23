// The catalog lists its results in ordered tiers (titles named like the
// search first, then the personalized "relevant to you" tier, then the rest),
// paged as ONE list. Given each tier's size, which part of which tier a page
// shows: page 2 may start inside tier 0 and run on into tier 1.

export type TierSlice = { tier: number; skip: number; take: number };

export function tierSlices(counts: readonly number[], skip: number, take: number): TierSlice[] {
  const slices: TierSlice[] = [];
  let offset = 0;
  let left = take;
  for (let tier = 0; tier < counts.length && left > 0; tier++) {
    const count = counts[tier];
    const start = Math.max(0, skip - offset);
    if (start < count) {
      const n = Math.min(left, count - start);
      slices.push({ tier, skip: start, take: n });
      left -= n;
    }
    offset += count;
  }
  return slices;
}
