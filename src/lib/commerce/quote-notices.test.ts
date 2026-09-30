import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDeskQuoteAcceptedNotice,
  buildOrderConfirmedNotice,
  buildQuoteSentNotice,
} from "./quote-notices";

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

test("unknown locales fall back to English", () => {
  assert.equal(
    buildOrderConfirmedNotice({ locale: "nl", planName: "P" }).title,
    "Order confirmed: P",
  );
});

test("desk notice only says multi-market when more than one market accepted", () => {
  const single = buildDeskQuoteAcceptedNotice({ orgName: "Acme", planName: "P", orderCount: 1 });
  assert.equal(single.title, "Quote accepted");
  assert.ok(!single.body.includes("market"));
  const multi = buildDeskQuoteAcceptedNotice({ orgName: "Acme", planName: "P", orderCount: 3 });
  assert.equal(multi.title, "3 quotes accepted");
  assert.match(multi.body, /3-market campaign/);
});
