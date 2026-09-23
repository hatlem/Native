import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToBuffer } from "@react-pdf/renderer";
import { QuoteDocument } from "./QuoteDocument";
import { quoteOnlineUrl } from "./quote-online-url";
import type { QuotePdfData } from "./quote-pdf-data";
import enMessages from "@/messages/en.json";
import svMessages from "@/messages/sv.json";
import { quoteFormatLabel } from "./quote-messages";

test("quoteOnlineUrl: absolute buyer request page, no double slash", () => {
  const prev = process.env.AUTH_URL;
  process.env.AUTH_URL = "https://www.nativespin.com/";
  try {
    assert.equal(
      quoteOnlineUrl("req_123", "sv"),
      "https://www.nativespin.com/sv/requests/req_123",
    );
  } finally {
    if (prev === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = prev;
  }
});

test("QuoteDocument: renders with a price-on-request line and links back online", async () => {
  const onlineUrl = "https://www.nativespin.com/sv/requests/req_123";
  const data: QuotePdfData = {
    quoteId: "q1",
    quoteNumber: "ABCD1234",
    currency: "SEK",
    vatPct: 25,
    subtotal: 17250,
    total: 21562.5,
    validUntil: null,
    createdAt: new Date("2026-09-23T00:00:00Z"),
    organizationName: "ABAX Sverige",
    preparedByName: "Desk",
    preparedByEmail: "desk@nativespin.com",
    onlineUrl,
    rows: [
      {
        titleName: "Trailer",
        marketCode: "SE",
        format: "NATIVE_ARTICLE",
        quantity: 1,
        unitPrice: 17250,
        rowTotal: 17250,
        priceOnRequest: false,
        circulation: null,
        digitalReach: 54969,
        audience: null,
        vertical: null,
        frequency: null,
      },
      {
        titleName: "Intelligent Logistik",
        marketCode: "SE",
        format: "NATIVE_ARTICLE",
        quantity: 1,
        unitPrice: null,
        rowTotal: null,
        priceOnRequest: true,
        circulation: null,
        digitalReach: null,
        audience: null,
        vertical: null,
        frequency: null,
      },
    ],
  };

  const pdf = Buffer.from(
    await renderToBuffer(QuoteDocument({ data, locale: "sv", messages: svMessages.quotePdf })),
  ).toString("latin1");

  // Link annotations live in uncompressed object dictionaries: header,
  // "view online" box and the fixed footer each carry one.
  const uris = pdf.match(/\/URI \(([^)]*)\)/g) ?? [];
  assert.ok(uris.length >= 3, `expected >=3 link annotations, got ${uris.length}`);
  for (const u of uris) assert.ok(u.includes(onlineUrl), `unexpected link target: ${u}`);
});

test("quoteFormatLabel: localized catalog name, never the raw enum", () => {
  assert.equal(quoteFormatLabel("NATIVE_ARTICLE", "sv"), svMessages.productType.NATIVE_ARTICLE);
  assert.equal(quoteFormatLabel("PACKAGE", "sv"), svMessages.productType.PACKAGE);
  // Unknown locale falls back to English; unknown type to the stored value.
  assert.equal(quoteFormatLabel("NATIVE_ARTICLE", "xx"), enMessages.productType.NATIVE_ARTICLE);
  assert.equal(quoteFormatLabel("SOMETHING_NEW", "sv"), "SOMETHING_NEW");
  assert.equal(quoteFormatLabel("", "sv"), "");
});
