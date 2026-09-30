import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPEN_ASSET_STATUSES,
  canMoveAsset,
  isTerminalAssetStatus,
  nextAssetStatuses,
  supersedesOlderVersions,
  supersedeOlderVersions,
} from "./versions";

test("handing a version over (review, approval, final) supersedes older open ones", () => {
  assert.equal(supersedesOlderVersions("IN_REVIEW"), true);
  assert.equal(supersedesOlderVersions("APPROVED"), true);
  assert.equal(supersedesOlderVersions("FINAL"), true);
  assert.equal(supersedesOlderVersions("CHANGES_REQUESTED"), false);
  assert.equal(supersedesOlderVersions("DRAFT"), false);
});

test("only SUPERSEDED is terminal", () => {
  assert.equal(isTerminalAssetStatus("SUPERSEDED"), true);
  assert.equal(isTerminalAssetStatus("FINAL"), false);
});

test("supersedeOlderVersions touches only older, still-open versions of the article", async () => {
  let captured: unknown = null;
  const db = {
    contentAsset: {
      updateMany: async (args: unknown) => {
        captured = args;
        return { count: 2 };
      },
    },
  };
  const n = await supersedeOlderVersions(db as never, { articleId: "a1", version: 3 });
  assert.equal(n, 2);
  assert.deepEqual(captured, {
    where: { articleId: "a1", version: { lt: 3 }, status: { in: [...OPEN_ASSET_STATUSES] } },
    data: { status: "SUPERSEDED" },
  });
  // Approved/final history is never rewritten.
  assert.ok(!OPEN_ASSET_STATUSES.includes("APPROVED"));
  assert.ok(!OPEN_ASSET_STATUSES.includes("FINAL"));
});

test("an approved version moves only forward to FINAL, never back into review", () => {
  assert.deepEqual(nextAssetStatuses("APPROVED"), ["FINAL"]);
  for (const to of ["IN_REVIEW", "APPROVED", "CHANGES_REQUESTED", "DRAFT"] as const) {
    assert.equal(canMoveAsset("APPROVED", to), false, to);
  }
  assert.equal(canMoveAsset("APPROVED", "FINAL"), true);
});

test("review moves: submit from a draft, decide from review, nothing from history", () => {
  assert.equal(canMoveAsset("DRAFT", "IN_REVIEW"), true);
  assert.equal(canMoveAsset("CHANGES_REQUESTED", "IN_REVIEW"), true);
  assert.equal(canMoveAsset("IN_REVIEW", "APPROVED"), true);
  assert.equal(canMoveAsset("IN_REVIEW", "CHANGES_REQUESTED"), true);
  assert.equal(canMoveAsset("IN_REVIEW", "IN_REVIEW"), false);
  assert.equal(canMoveAsset("DRAFT", "FINAL"), false);
  assert.deepEqual(nextAssetStatuses("FINAL"), []);
  assert.deepEqual(nextAssetStatuses("SUPERSEDED"), []);
});
