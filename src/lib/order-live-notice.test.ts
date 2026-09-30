import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrderLiveNotice } from "./order-live-notice";
import { buildOrderCompletedNotice } from "./order-completed-notice";

const LOCALES = ["en", "no", "sv", "da", "fi", "de"] as const;

test("live notice claims 'published' only when every placement is", () => {
  const all = buildOrderLiveNotice({ locale: "en", planName: "Q3", published: 3, total: 3 });
  assert.equal(all.title, "Your campaign is published: Q3");
  assert.match(all.body, /All 3 placements are published/);

  const some = buildOrderLiveNotice({ locale: "en", planName: "Q3", published: 1, total: 3 });
  assert.equal(some.title, "Campaign update: Q3");
  assert.match(some.body, /1 of 3 placements are published so far/);

  const none = buildOrderLiveNotice({ locale: "en", planName: "Q3", published: 0, total: 3 });
  assert.equal(none.title, "Campaign update: Q3");
  assert.match(none.body, /no placement has a published link yet/);
  assert.doesNotMatch(none.title + none.body, /is published/);
});

test("live notice: singular placement reads naturally", () => {
  const one = buildOrderLiveNotice({ locale: "no", planName: "Q3", published: 1, total: 1 });
  assert.equal(one.title, "Kampanjen din er publisert: Q3");
  assert.equal(one.body.startsWith("Plasseringen er publisert."), true);
});

test("live notice: every locale has all three variants, unknown locale → English", () => {
  for (const locale of LOCALES) {
    const a = buildOrderLiveNotice({ locale, planName: "P", published: 2, total: 2 });
    const s = buildOrderLiveNotice({ locale, planName: "P", published: 1, total: 2 });
    const n = buildOrderLiveNotice({ locale, planName: "P", published: 0, total: 2 });
    assert.notEqual(a.title, s.title, locale);
    assert.notEqual(s.body, n.body, locale);
    assert.ok(s.body.includes("1") && s.body.includes("2"), locale);
  }
  assert.equal(
    buildOrderLiveNotice({ locale: "xx", planName: "P", published: 0, total: 1 }).title,
    "Campaign update: P",
  );
});

test("completed notice states the published count instead of 'your placements have run'", () => {
  const partial = buildOrderCompletedNotice({
    locale: "en",
    planName: "Q3",
    due: null,
    delivery: { published: 0, total: 3 },
  });
  assert.doesNotMatch(partial.body, /have run/);
  assert.match(partial.body, /0 of 3 placements have a published link/);

  const full = buildOrderCompletedNotice({
    locale: "en",
    planName: "Q3",
    due: null,
    delivery: { published: 3, total: 3 },
  });
  assert.match(full.body, /Your placements have run/);

  const dueWave = buildOrderCompletedNotice({
    locale: "no",
    planName: "Q3",
    due: { waveNumber: 2, plannedWaves: 3, articleTitle: null },
    delivery: { published: 1, total: 2 },
  });
  assert.match(dueWave.body, /Runde 2 av 3/);
  assert.match(dueWave.body, /1 av 2 plasseringer har publisert lenke/);
});

test("completed notice: partial-delivery copy exists in every locale", () => {
  for (const locale of LOCALES) {
    const full = buildOrderCompletedNotice({ locale, planName: "P", due: null });
    const partial = buildOrderCompletedNotice({
      locale,
      planName: "P",
      due: null,
      delivery: { published: 1, total: 2 },
    });
    assert.notEqual(full.body, partial.body, locale);
  }
});
