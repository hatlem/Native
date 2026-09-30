import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrderConfirmedNotice, buildQuoteSentNotice } from "./quote-notices";

const LOCALES = ["en", "no", "sv", "da", "fi", "de"] as const;
const VALID_UNTIL = new Date("2026-10-14T23:59:59.999Z");

test("the sent notice carries the real total and the chosen validity day", () => {
  const n = buildQuoteSentNotice({
    locale: "en",
    planName: "Q4 launch",
    quotes: [{ total: 156250, currency: "NOK" }],
    onRequestCount: 0,
    validUntil: VALID_UNTIL,
  });
  assert.equal(n.title, "Your quote is ready: Q4 launch");
  assert.match(n.body, /156,250/);
  assert.match(n.body, /14 October 2026/);
  assert.ok(!n.body.includes("on request"));
});

test("the validity day is printed in UTC, not shifted by the server zone", () => {
  const n = buildQuoteSentNotice({
    locale: "no",
    planName: "P",
    quotes: [{ total: 1000, currency: "NOK" }],
    onRequestCount: 0,
    validUntil: VALID_UNTIL,
  });
  assert.match(n.body, /14\. oktober 2026/);
});

test("multi-market totals are all listed; on-request lines are called out", () => {
  const n = buildQuoteSentNotice({
    locale: "en",
    planName: "Nordics",
    quotes: [
      { total: 10000, currency: "NOK" },
      { total: 8000, currency: "SEK" },
    ],
    onRequestCount: 2,
    validUntil: VALID_UNTIL,
  });
  assert.match(n.body, /NOK.*\+.*SEK/);
  assert.match(n.body, /2 lines are priced on request/);
});

test("renewed notices say so", () => {
  const n = buildQuoteSentNotice({
    locale: "de",
    planName: "Herbst",
    quotes: [{ total: 5000, currency: "EUR" }],
    onRequestCount: 0,
    validUntil: VALID_UNTIL,
    renewed: true,
  });
  assert.equal(n.title, "Ihr Angebot wurde verlängert: Herbst");
});

test("every locale has sent + order-confirmed copy naming the plan", () => {
  for (const locale of LOCALES) {
    const sent = buildQuoteSentNotice({
      locale,
      planName: "PLAN-X",
      quotes: [{ total: 1234, currency: "EUR" }],
      onRequestCount: 1,
      validUntil: VALID_UNTIL,
    });
    assert.ok(sent.title.includes("PLAN-X"), locale);
    assert.ok(sent.body.length > 20, locale);
    const confirmed = buildOrderConfirmedNotice({ locale, planName: "PLAN-X" });
    assert.ok(confirmed.title.includes("PLAN-X"), locale);
    assert.ok(confirmed.body.length > 20, locale);
  }
});

test("a revised quote says it was revised, which revision, and that the old one is gone", () => {
  const n = buildQuoteSentNotice({
    locale: "en",
    planName: "Q4 launch",
    quotes: [{ total: 98000, currency: "NOK" }],
    onRequestCount: 0,
    validUntil: VALID_UNTIL,
    revision: 2,
  });
  assert.equal(n.title, "Your quote has been revised (revision 2): Q4 launch");
  assert.match(n.body, /replaces the quote you received earlier/);
  assert.match(n.body, /98,000/, "carries the NEW total");
  for (const locale of LOCALES) {
    const l = buildQuoteSentNotice({
      locale,
      planName: "PLAN-X",
      quotes: [{ total: 1, currency: "EUR" }],
      onRequestCount: 0,
      validUntil: VALID_UNTIL,
      revision: 3,
    });
    assert.ok(l.title.includes("PLAN-X") && l.title.includes("3"), locale);
    assert.notEqual(
      l.title,
      buildQuoteSentNotice({ locale, planName: "PLAN-X", quotes: [{ total: 1, currency: "EUR" }], onRequestCount: 0, validUntil: VALID_UNTIL }).title,
      `${locale}: a revision must not read like a first quote`,
    );
  }
});

test("unknown locales fall back to English", () => {
  assert.equal(
    buildOrderConfirmedNotice({ locale: "nl", planName: "P" }).title,
    "Order confirmed: P",
  );
});
