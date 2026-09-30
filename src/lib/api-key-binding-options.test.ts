import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBindingOptions, type BindingOptionLabels } from "./api-key-binding-options";

const labels: BindingOptionLabels = {
  platform: "Platform",
  advertiser: "Advertiser",
  agency: "Agency",
  moreTitles: (n) => `+${n} more`,
  noTitles: "no titles",
};

test("platform first, then organisations, then publishers, each sorted by name", () => {
  const opts = buildBindingOptions(
    {
      orgs: [
        { id: "o2", name: "Zeta AS", type: "ADVERTISER", marketCode: "NO" },
        { id: "o1", name: "Acme Agency", type: "AGENCY", marketCode: "SE" },
      ],
      publishers: [
        { id: "p2", name: "Øst Media", countryCode: "NO", titles: [], titleCount: 0 },
        { id: "p1", name: "aller media", countryCode: "DK", titles: ["Bo Bedre"], titleCount: 1 },
        { id: "p3", name: "10TAL", countryCode: "SE", titles: ["10TAL"], titleCount: 1 },
      ],
    },
    labels,
    "no",
  );
  assert.deepEqual(
    opts.map((o) => o.value),
    ["", "org:o1", "org:o2", "pub:p3", "pub:p1", "pub:p2"],
  );
  assert.equal(opts[1].detail, "Agency · SE");
  assert.equal(opts[5].detail, "NO · no titles");
});

test("same-named publishers are told apart by market and titles, then by id", () => {
  const opts = buildBindingOptions(
    {
      orgs: [],
      publishers: [
        { id: "pub-aaaaaa1", name: "AB", countryCode: "SE", titles: ["Dagbladet Sverige", "Nyheter X", "Z"], titleCount: 5 },
        { id: "pub-bbbbbb2", name: "AB", countryCode: "FI", titles: ["Seura"], titleCount: 1 },
        { id: "pub-cccccc3", name: "AB", countryCode: "FI", titles: ["Seura"], titleCount: 1 },
      ],
    },
    labels,
    "en",
  );
  const pubs = opts.filter((o) => o.group === "pub");
  assert.equal(pubs.find((o) => o.value === "pub:pub-aaaaaa1")?.detail, "SE · Dagbladet Sverige, Nyheter X +3 more");
  // Identical name and detail: an id suffix keeps them distinct.
  const details = pubs.map((o) => o.detail);
  assert.equal(new Set(details).size, details.length);
});
