import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeskRequestsQuery, deskRequestsHref } from "./desk-requests-query";

test("parseDeskRequestsQuery: defaults to the open queue, page 1", () => {
  assert.deepEqual(parseDeskRequestsQuery({}), { q: "", status: "open", page: 1 });
});

test("parseDeskRequestsQuery: rejects unknown statuses and bad pages", () => {
  assert.equal(parseDeskRequestsQuery({ status: "DRAFT" }).status, "open");
  assert.equal(parseDeskRequestsQuery({ status: "QUOTED" }).status, "QUOTED");
  assert.equal(parseDeskRequestsQuery({ page: "-3" }).page, 1);
  assert.equal(parseDeskRequestsQuery({ page: "abc" }).page, 1);
  assert.equal(parseDeskRequestsQuery({ page: ["2", "3"] }).page, 1);
});

test("deskRequestsHref: omits defaults and round-trips", () => {
  assert.equal(deskRequestsHref({ q: "", status: "open", page: 1 }), "/desk/requests");
  const href = deskRequestsHref({ q: "acme as", status: "all", page: 3 });
  assert.equal(href, "/desk/requests?q=acme+as&status=all&page=3");
  const sp = Object.fromEntries(new URL(href, "http://x").searchParams);
  assert.deepEqual(parseDeskRequestsQuery(sp), { q: "acme as", status: "all", page: 3 });
});
