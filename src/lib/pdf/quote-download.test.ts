import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentDisposition, quoteDownloadDecision } from "./quote-download";

test("the owning buyer may download a sent quote; the desk any quote", () => {
  for (const status of ["SENT", "ACCEPTED", "EXPIRED", "DECLINED"] as const) {
    assert.equal(quoteDownloadDecision({ isDesk: false, canActOnOwningOrg: true, status }), "buyer", status);
  }
  for (const status of ["DRAFT", "SENT", "ACCEPTED"] as const) {
    assert.equal(quoteDownloadDecision({ isDesk: true, canActOnOwningOrg: true, status }), "desk", status);
  }
});

test("another org, or the buyer asking for a draft, reads as not found", () => {
  assert.equal(quoteDownloadDecision({ isDesk: false, canActOnOwningOrg: false, status: "SENT" }), "not_found");
  assert.equal(quoteDownloadDecision({ isDesk: false, canActOnOwningOrg: true, status: "DRAFT" }), "not_found");
  // Never "superseded" for an outsider: that would confirm the quote exists.
  assert.equal(
    quoteDownloadDecision({ isDesk: false, canActOnOwningOrg: false, status: "SUPERSEDED" }),
    "not_found",
  );
});

test("a replaced quote makes no new document, for the buyer or the desk", () => {
  assert.equal(quoteDownloadDecision({ isDesk: false, canActOnOwningOrg: true, status: "SUPERSEDED" }), "superseded");
  assert.equal(quoteDownloadDecision({ isDesk: true, canActOnOwningOrg: true, status: "SUPERSEDED" }), "superseded");
});

test("attachment header carries the UTF-8 name and an ASCII fallback", () => {
  assert.equal(
    attachmentDisposition("Tilbud ÆØÅ.pdf"),
    `attachment; filename="Tilbud A.pdf"; filename*=UTF-8''Tilbud%20%C3%86%C3%98%C3%85.pdf`,
  );
});
