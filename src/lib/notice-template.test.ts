import { test } from "node:test";
import assert from "node:assert/strict";
import { renderNotice, renderStoredNotice, type NoticeTemplate } from "./notice-template";

const placement: NoticeTemplate = {
  key: "placementReady",
  params: { titleName: "Arkitektur", listName: "ABAX SE", listId: "list1" },
};

// BUG-prod-api-18: a Norwegian user in a Swedish-market org read "Arkitektur
// har nu ett pris". The stored row renders in whoever is reading it.
test("the same stored notice renders in each viewer's language, link included", () => {
  const stored = JSON.parse(JSON.stringify(placement.params));
  const no = renderStoredNotice("placementReady", stored, "no");
  const sv = renderStoredNotice("placementReady", stored, "sv");
  assert.equal(no?.title, "Arkitektur har nå en pris");
  assert.equal(sv?.title, "Arkitektur har nu ett pris");
  assert.equal(no?.link, "/no/plan/list1");
  assert.equal(sv?.link, "/sv/plan/list1");
});

test("renderNotice matches the builder output the email is sent with", () => {
  const en = renderNotice(placement, "en");
  assert.equal(en.title, "Arkitektur now has a price");
  assert.match(en.body, /“ABAX SE”/);
});

test("dates survive the JSON round trip (quote validity)", () => {
  const template: NoticeTemplate = {
    key: "quoteSent",
    params: {
      planName: "Q4",
      quotes: [{ total: 1000, currency: "NOK" }],
      onRequestCount: 0,
      validUntil: "2026-10-12T00:00:00.000Z",
      requestId: "req1",
    },
  };
  const stored = JSON.parse(JSON.stringify(template.params));
  const de = renderStoredNotice("quoteSent", stored, "de");
  assert.ok(de);
  assert.match(de.body, /12\. Oktober 2026/);
  assert.equal(de.link, "/de/requests/req1");
});

test("unknown keys and params from another shape fall back to the stored strings", () => {
  assert.equal(renderStoredNotice(null, null, "no"), null);
  assert.equal(renderStoredNotice("noSuchNotice", {}, "no"), null);
  assert.equal(renderStoredNotice("toString", {}, "no"), null, "no prototype keys");
  assert.equal(renderStoredNotice("placementReady", { titleName: "x" }, "no"), null);
});

// BUG-buyer-plan-23: the client-approval notice was English everywhere and
// linked to /plan (whatever plan the reader last had open).
test("client approval renders per reader and links to the approved plan", () => {
  const stored = { planName: "Q4 trade press", listId: "list9" };
  const no = renderStoredNotice("clientApproved", stored, "no");
  assert.equal(no?.title, "Kunden godkjente: Q4 trade press");
  assert.equal(no?.link, "/no/plan/list9");
  assert.equal(renderStoredNotice("clientApproved", stored, "de")?.link, "/de/plan/list9");
  assert.equal(renderNotice({ key: "clientApproved", params: stored }, "en").title, "Client approved: Q4 trade press");
});

test("order templates keep their deep links per viewer", () => {
  const confirmed = renderStoredNotice("orderConfirmed", { planName: "P", requestId: "r", orderId: null }, "fi");
  assert.equal(confirmed?.link, "/fi/requests/r");
  const live = renderStoredNotice("orderLive", { planName: "P", orderId: "o", published: 1, total: 2 }, "da");
  assert.equal(live?.link, "/da/orders/o");
});
