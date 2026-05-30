import { test } from "node:test";
import assert from "node:assert/strict";
import { pickPlaybook, type PlaybookMatchable } from "./playbook";

type P = PlaybookMatchable & { id: string };

const PB: P[] = [
  { id: "global", productType: null, category: null, marketCode: null, active: true },
  { id: "type", productType: "NATIVE_ARTICLE", category: null, marketCode: null, active: true },
  { id: "type+cat", productType: "NATIVE_ARTICLE", category: "business", marketCode: null, active: true },
  { id: "type+cat+mkt", productType: "NATIVE_ARTICLE", category: "business", marketCode: "NO", active: true },
  { id: "inactive", productType: "NATIVE_ARTICLE", category: "business", marketCode: "NO", active: false },
];

test("pickPlaybook prefers the most specific active match", () => {
  assert.equal(pickPlaybook(PB, "NATIVE_ARTICLE", "business", "NO")?.id, "type+cat+mkt");
});

test("pickPlaybook falls back down the specificity ladder", () => {
  // SE has no market-specific rule -> type+cat
  assert.equal(pickPlaybook(PB, "NATIVE_ARTICLE", "business", "SE")?.id, "type+cat");
  // lifestyle has no category rule -> type
  assert.equal(pickPlaybook(PB, "NATIVE_ARTICLE", "lifestyle", "NO")?.id, "type");
  // another type entirely -> global
  assert.equal(pickPlaybook(PB, "ADVERTORIAL", "sports", "DK")?.id, "global");
});

test("pickPlaybook ignores inactive playbooks", () => {
  const onlyInactive: P[] = [
    { id: "x", productType: "NATIVE_ARTICLE", category: "business", marketCode: "NO", active: false },
  ];
  assert.equal(pickPlaybook(onlyInactive, "NATIVE_ARTICLE", "business", "NO"), null);
});

test("pickPlaybook returns null when nothing matches", () => {
  const narrow: P[] = [
    { id: "se-only", productType: null, category: null, marketCode: "SE", active: true },
  ];
  assert.equal(pickPlaybook(narrow, "NATIVE_ARTICLE", "business", "NO"), null);
});
