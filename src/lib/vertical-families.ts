import type { Prisma } from "@prisma/client";

// Title.vertical is a flat research taxonomy whose values carry their own
// hierarchy in the name: "B2B – Energy & Utilities", "News (Local)",
// "Sports – Golf". A family is the shared head ("B2B", "News", "Sports"), and
// the catalog's category filter offers it as one choice ("All B2B") next to
// the individual verticals, carried in the URL as `vertical=family:B2B`.
// Matching is by the stored value's head, so a vertical added to the research
// data later joins its family without a code change.

export const FAMILY_PREFIX = "family:";

const HEAD_RE = /^(.+?)\s+(?:[–—-]\s+.+|\(.+\))$/u;
const SEPARATORS = [" –", " —", " -", " ("] as const;

/** "B2B – Energy" → "B2B", "News (Local)" → "News"; null for a vertical
 *  with no head ("Lifestyle"). */
export function verticalHead(value: string): string | null {
  const m = value.trim().match(HEAD_RE);
  return m ? m[1].trim() : null;
}

const fold = (s: string) => s.trim().toLocaleLowerCase("en");

export function isFamilyToken(v: string): boolean {
  return v.startsWith(FAMILY_PREFIX) && v.length > FAMILY_PREFIX.length;
}

export function familyToken(head: string): string {
  return `${FAMILY_PREFIX}${head}`;
}

export function familyOfToken(v: string): string {
  return v.slice(FAMILY_PREFIX.length);
}

/** Whether a stored vertical belongs to a family: the head itself
 *  ("Sports") or any value headed by it ("Sports – Golf"). */
export function inFamily(value: string, head: string): boolean {
  const h = verticalHead(value);
  return fold(value) === fold(head) || (h !== null && fold(h) === fold(head));
}

export type VerticalOption = { value: string; label: string };
export type VerticalFamily = {
  token: string;
  head: string;
  label: string;
  members: VerticalOption[];
};

/**
 * The families among the catalog's vertical options: every head shared by at
 * least two options. The family label comes from its members' localized
 * labels ("B2B – helse" → "B2B", "Nyheter (lokal)" → "Nyheter"), so no
 * family needs its own translation. Families keep the order of their first
 * member; members keep the options' order.
 */
export function verticalFamilies(options: readonly VerticalOption[]): VerticalFamily[] {
  const byHead = new Map<string, { head: string; members: VerticalOption[] }>();
  for (const o of options) {
    const head = verticalHead(o.value) ?? o.value;
    const key = fold(head);
    const entry = byHead.get(key) ?? { head, members: [] };
    entry.members.push(o);
    byHead.set(key, entry);
  }
  const families: VerticalFamily[] = [];
  for (const { head, members } of byHead.values()) {
    if (members.length < 2) continue;
    const headed = members.find((m) => verticalHead(m.value) !== null);
    const label =
      (headed && verticalHead(headed.label)) ??
      members.find((m) => fold(m.value) === fold(head))?.label ??
      head;
    families.push({ token: familyToken(head), head, label, members });
  }
  return families;
}

/** The catalog where for the `vertical` param: exact verticals and whole
 *  families, any of them (OR). Null when nothing is selected. */
export function verticalFilterWhere(selected: readonly string[]): Prisma.TitleWhereInput | null {
  const exact = selected.filter((v) => !isFamilyToken(v));
  const heads = selected.filter(isFamilyToken).map(familyOfToken);
  const or: Prisma.TitleWhereInput[] = [];
  if (exact.length) or.push({ vertical: { in: exact } });
  for (const head of heads) {
    or.push({ vertical: { equals: head, mode: "insensitive" } });
    for (const sep of SEPARATORS) {
      or.push({ vertical: { startsWith: `${head}${sep}`, mode: "insensitive" } });
    }
  }
  if (or.length === 0) return null;
  return or.length === 1 ? or[0] : { OR: or };
}

/** Whether a vertical option shows as ticked: chosen itself, or covered by
 *  a chosen family. */
export function isVerticalSelected(value: string, selected: readonly string[]): boolean {
  return selected.some((s) => (isFamilyToken(s) ? inFamily(value, familyOfToken(s)) : s === value));
}

/**
 * Toggles one choice in the category selection. Ticking a family replaces its
 * individual members (the family covers them); unticking a member of a chosen
 * family keeps the family's other members selected individually.
 */
export function toggleVerticalSelection(
  selected: readonly string[],
  value: string,
  family?: VerticalFamily,
): string[] {
  if (isFamilyToken(value)) {
    if (selected.includes(value)) return selected.filter((s) => s !== value);
    const head = familyOfToken(value);
    return [...selected.filter((s) => isFamilyToken(s) || !inFamily(s, head)), value];
  }
  const coveringFamily = selected.find((s) => isFamilyToken(s) && inFamily(value, familyOfToken(s)));
  if (coveringFamily) {
    const rest = (family?.members ?? []).map((m) => m.value).filter((v) => v !== value);
    return [...selected.filter((s) => s !== coveringFamily), ...rest];
  }
  return selected.includes(value) ? selected.filter((s) => s !== value) : [...selected, value];
}

/** Case- and accent-insensitive match of a typed filter against an option's
 *  label and stored value ("bygg" finds "B2B – bygg og eiendom",
 *  "naering" finds "Næringsliv og finans"). */
export function matchesCategoryFilter(option: VerticalOption, typed: string): boolean {
  const needle = normalizeForFilter(typed);
  if (!needle) return true;
  return normalizeForFilter(option.label).includes(needle) || normalizeForFilter(option.value).includes(needle);
}

function normalizeForFilter(s: string): string {
  return s
    .toLocaleLowerCase("nb")
    .replace(/æ/g, "ae")
    .replace(/[øö]/g, "o")
    .replace(/[åä]/g, "a")
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .trim();
}
