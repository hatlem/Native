// The options of the /desk/api-keys "Acts for" picker, built on the server.
// Pure (no DB) so the sorting and disambiguation rules unit-test.

export type BindingOptionInput = {
  orgs: Array<{ id: string; name: string; type: "ADVERTISER" | "AGENCY"; marketCode: string | null }>;
  publishers: Array<{ id: string; name: string; countryCode: string; titles: string[]; titleCount: number }>;
};

export type BindingOptionLabels = {
  platform: string;
  advertiser: string;
  agency: string;
  // "+{count} more" after the first titles of a publisher.
  moreTitles: (count: number) => string;
  noTitles: string;
};

export type BuiltBindingOption = {
  value: string;
  group: "platform" | "org" | "pub";
  name: string;
  detail: string;
};

// How many of a publisher's titles its detail line names.
const TITLES_NAMED = 2;

/** Platform first, then organisations, then publishers, each sorted by name
 *  in the viewer's language (then by detail). Every option says what tells
 *  it apart: market and type for an organisation, market and its titles for
 *  a publisher. Entries that still read identically get a short id suffix, so
 *  no two options look the same. */
export function buildBindingOptions(
  input: BindingOptionInput,
  labels: BindingOptionLabels,
  locale: string,
): BuiltBindingOption[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const byName = (a: BuiltBindingOption, b: BuiltBindingOption) =>
    collator.compare(a.name, b.name) || collator.compare(a.detail, b.detail);

  const orgs: BuiltBindingOption[] = input.orgs.map((o) => ({
    value: `org:${o.id}`,
    group: "org",
    name: o.name.trim(),
    detail: [o.type === "AGENCY" ? labels.agency : labels.advertiser, o.marketCode].filter(Boolean).join(" · "),
  }));
  const pubs: BuiltBindingOption[] = input.publishers.map((p) => {
    const named = p.titles.slice(0, TITLES_NAMED);
    const rest = p.titleCount - named.length;
    const titles = named.length
      ? `${named.join(", ")}${rest > 0 ? ` ${labels.moreTitles(rest)}` : ""}`
      : labels.noTitles;
    return { value: `pub:${p.id}`, group: "pub", name: p.name.trim(), detail: `${p.countryCode} · ${titles}` };
  });

  const disambiguate = (list: BuiltBindingOption[]) => {
    const seen = new Map<string, number>();
    for (const o of list) seen.set(`${o.name}|${o.detail}`, (seen.get(`${o.name}|${o.detail}`) ?? 0) + 1);
    return list.map((o) =>
      (seen.get(`${o.name}|${o.detail}`) ?? 0) > 1
        ? { ...o, detail: `${o.detail} · #${o.value.slice(-6)}` }
        : o,
    );
  };

  return [
    { value: "", group: "platform", name: labels.platform, detail: "" },
    ...disambiguate(orgs).sort(byName),
    ...disambiguate(pubs).sort(byName),
  ];
}
