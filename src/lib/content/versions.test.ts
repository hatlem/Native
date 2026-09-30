import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPEN_ASSET_STATUSES,
  isTerminalAssetStatus,
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
