import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceLineLabel } from "./invoice-line-label";
import { quoteFormatLabel } from "./pdf/quote-messages";

const no = {
  formatLabel: (type: string) => quoteFormatLabel(type, "no"),
  contentProduction: "Innholdsproduksjon",
};

test("snapshot fields: title + translated format, never the enum", () => {
  const label = invoiceLineLabel(
    {
      description: "Verdens Gang (VG) — NATIVE_ARTICLE",
      kind: "INVENTORY",
      titleName: "Verdens Gang (VG)",
      productType: "NATIVE_ARTICLE",
    },
    no,
  );
  assert.equal(label, `Verdens Gang (VG) — ${quoteFormatLabel("NATIVE_ARTICLE", "no")}`);
  assert.doesNotMatch(label, /NATIVE_ARTICLE/);
});

test("content fee lines are labelled as content production for their placement", () => {
  const label = invoiceLineLabel(
    {
      description: "Content production — Aftenposten — NATIVE_DISPLAY",
      kind: "CONTENT_FEE",
      titleName: "Aftenposten",
      productType: "NATIVE_DISPLAY",
    },
    no,
  );
  assert.equal(label, `Innholdsproduksjon: Aftenposten — ${quoteFormatLabel("NATIVE_DISPLAY", "no")}`);
});

test("legacy lines (description only) are parsed: trailing enum and fee prefix", () => {
  assert.equal(
    invoiceLineLabel({ description: "Verdens Gang (VG) — NATIVE_ARTICLE" }, no),
    `Verdens Gang (VG) — ${quoteFormatLabel("NATIVE_ARTICLE", "no")}`,
  );
  assert.equal(
    invoiceLineLabel({ description: "Content production — E24 — ADVERTORIAL" }, no),
    `Innholdsproduksjon: E24 — ${quoteFormatLabel("ADVERTORIAL", "no")}`,
  );
});

test("legacy lines without an enum suffix are left as written", () => {
  assert.equal(invoiceLineLabel({ description: "Aftenposten native display" }, no), "Aftenposten native display");
  // An uppercase word that isn't a ProductType is not a format.
  assert.equal(invoiceLineLabel({ description: "Campaign — Q3 — NOK" }, no), "Campaign — Q3 — NOK");
});
