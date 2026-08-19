import { test } from "node:test";
import assert from "node:assert/strict";
import { navItemsFor, audienceFor, paletteItemsFor } from "./nav";

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

// Staff (desk/superadmin) who ALSO hold a buyer-org membership — e.g.
// helping a client build their plan — otherwise have no way back into the
// buyer flow: it's absent from both the desk top nav and, without
// hasOrgAccess, the palette too.
test("staff palette: no buyer-flow items without org access", () => {
  for (const audience of ["desk", "superadmin"] as const) {
    const keys = paletteItemsFor(audience, t)
      .flatMap((s) => s.items)
      .map((i) => i.key);
    assert.ok(!keys.includes("plan"), `${audience} palette must not leak /plan without org access`);
    assert.ok(!keys.includes("campaign"), `${audience} palette must not leak /campaign without org access`);
  }
});

test("staff palette: hasOrgAccess surfaces the classic buyer flow", () => {
  const keys = paletteItemsFor("superadmin", t, { hasOrgAccess: true })
    .flatMap((s) => s.items)
    .map((i) => i.key);
  assert.ok(keys.includes("plan"));
  assert.ok(keys.includes("lists"));
  assert.ok(!keys.includes("campaign"));
});

test("staff palette: hasOrgAccess + campaignFlow surfaces the guided flow instead of classic /plan", () => {
  const keys = paletteItemsFor("superadmin", t, { hasOrgAccess: true, campaignFlow: true })
    .flatMap((s) => s.items)
    .map((i) => i.key);
  assert.ok(keys.includes("campaign"));
  assert.ok(keys.includes("campaigns"));
  assert.ok(!keys.includes("plan"));
});

test("desk (non-superadmin) palette also gets buyer-flow items with org access", () => {
  const keys = paletteItemsFor("desk", t, { hasOrgAccess: true })
    .flatMap((s) => s.items)
    .map((i) => i.key);
  assert.ok(keys.includes("plan"));
});
