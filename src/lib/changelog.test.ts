import { test } from "node:test";
import assert from "node:assert/strict";
import en from "@/messages/en.json";
import { CHANGELOG } from "./changelog";
import { SUBPROCESSORS } from "./subprocessors";

test("every changelog entry has copy and entries are newest first", () => {
  const entries = (en as unknown as { changelog: { entries: Record<string, { title: string; body: string }> } })
    .changelog.entries;
  for (const e of CHANGELOG) {
    assert.ok(entries[e.id]?.title, `missing title for ${e.id}`);
    assert.ok(entries[e.id]?.body, `missing body for ${e.id}`);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
  }
  const dates = CHANGELOG.map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test("every subprocessor has purpose and data copy", () => {
  const sp = (en as unknown as { subprocessors: Record<string, { purpose?: string; data?: string }> }).subprocessors;
  for (const s of SUBPROCESSORS) {
    assert.ok(sp[s.key]?.purpose, s.key);
    assert.ok(sp[s.key]?.data, s.key);
  }
});
