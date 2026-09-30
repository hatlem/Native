import { test } from "node:test";
import assert from "node:assert/strict";
import en from "@/messages/en.json";
import { PAGE_TITLE_KEYS } from "./page-title";

// The locale parity test keeps the other languages in step with en.json;
// this keeps en.json in step with the keys the layouts ask for.
test("every page-title key has English copy, and no copy is orphaned", () => {
  const titles = (en as { pageTitle: Record<string, string> }).pageTitle;
  assert.deepEqual(Object.keys(titles).sort(), [...PAGE_TITLE_KEYS].sort());
  for (const key of PAGE_TITLE_KEYS) assert.ok(titles[key]?.trim(), key);
});
