export type ImpressionsParse =
  | { ok: true; value: number | null }
  | { ok: false };

export function parseImpressions(raw: string): ImpressionsParse {
  const s = raw.trim();
  if (s === "") return { ok: true, value: null };
  if (!/^\d+$/.test(s)) return { ok: false };
  return { ok: true, value: Number(s) };
}
