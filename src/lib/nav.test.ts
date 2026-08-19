import { test } from "node:test";
import assert from "node:assert/strict";
import { navItemsFor, audienceFor } from "./nav";

const t = (k: string) => k; // identity translator — assert on keys

test("audienceFor: role/orgType → audience", () => {
  assert.equal(audienceFor(null), "public");
  assert.equal(audienceFor({ user: { role: "BUYER" } }), "advertiser");
  assert.equal(audienceFor({ user: { role: "BUYER", orgType: "AGENCY" } }), "agency");
  assert.equal(audienceFor({ user: { role: "DESK" } }), "desk");
});

test("advertiser nav: default keeps the classic menu, Home leading, no separate Orders (merged into Requests)", () => {
  const keys = navItemsFor("advertiser", t).map((i) => i.key);
  assert.deepEqual(keys, [
    "home",
    "catalog",
    "plan",
    "lists",
    "favorites",
    "requests",
    "articles",
    "reports",
  ]);
});

test("advertiser nav: campaignFlow cutover replaces menu with home + flow + campaigns + articles", () => {
  const keys = navItemsFor("advertiser", t, { campaignFlow: true }).map((i) => i.key);
  assert.deepEqual(keys, ["home", "campaign", "campaigns", "articles"]);
});

test("agency nav: campaignFlow cutover keeps the agency switcher", () => {
  const keys = navItemsFor("agency", t, { campaignFlow: true }).map((i) => i.key);
  assert.deepEqual(keys, ["home", "campaign", "campaigns", "articles", "agency"]);
});

test("the article library is buyer-side only — no articles entry in staff or writer navs", () => {
  for (const audience of ["desk", "superadmin", "writer", "publisher", "public"] as const) {
    const keys = navItemsFor(audience, t).map((i) => i.key);
    assert.ok(!keys.includes("articles"), `${audience} nav must not link /articles`);
  }
});

test("staff navs are unaffected by the campaignFlow flag", () => {
  const off = navItemsFor("desk", t).map((i) => i.key);
  const on = navItemsFor("desk", t, { campaignFlow: true }).map((i) => i.key);
  assert.deepEqual(on, off);
});
