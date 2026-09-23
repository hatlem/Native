import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { renderQuoteDocx } from "./quote-docx";
import { quoteMessagesFor } from "./quote-messages";
import type { QuotePdfData } from "./quote-pdf-data";

// Minimal zip reader (central directory) — enough to pull one entry out of
// the .docx without a test dependency.
function zipEntry(zip: Buffer, name: string): string {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = zip.readUInt32LE(eocd + 16);
  const count = zip.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    if (zip.toString("utf8", p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const raw = zip.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip entry not found: ${name}`);
}

const onlineUrl = "https://www.nativespin.com/sv/requests/req_123";
const row = {
  marketCode: "SE",
  format: "NATIVE_ARTICLE",
  quantity: 1,
  circulation: null,
  digitalReach: 54969,
  audience: null,
  vertical: null,
  frequency: null,
};
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
    { ...row, titleName: "Svensk Åkeritidning", unitPrice: 17250, rowTotal: 17250, priceOnRequest: false },
    // The stored estimate must never leak for an on-request line.
    { ...row, titleName: "Intelligent Logistik", unitPrice: null, rowTotal: null, priceOnRequest: true },
  ],
};

test("renderQuoteDocx: valid docx with localized copy, rows and the POR footnote", async () => {
  const docx = await renderQuoteDocx(data, "sv", quoteMessagesFor("sv"));
  assert.equal(docx.subarray(0, 2).toString(), "PK");
  const body = zipEntry(docx, "word/document.xml");
  assert.match(body, /Svensk Åkeritidning/);
  assert.match(body, /Intelligent Logistik/);
  assert.match(body, /Pris på förfrågan/);
  assert.match(body, /Se offerten online/);
  assert.match(body, /Rader märkta/); // footnote only renders with a POR line
});

test("renderQuoteDocx: every hyperlink targets the live quote page", async () => {
  const docx = await renderQuoteDocx(data, "sv", quoteMessagesFor("sv"));
  const rels = [
    zipEntry(docx, "word/_rels/document.xml.rels"),
    zipEntry(docx, "word/_rels/footer1.xml.rels"),
  ].join("\n");
  const targets = [...rels.matchAll(/Target="([^"]+)"\s+TargetMode="External"/g)].map((m) => m[1]);
  assert.ok(targets.length >= 3, `expected >=3 external links, got ${targets.length}`);
  for (const target of targets) assert.equal(target, onlineUrl);
});
