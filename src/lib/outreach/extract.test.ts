import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractCandidates } from "./extract";

const FIXTURES = join(process.cwd(), "test-fixtures", "scraper");
function load(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

test("extracts mailto + role + name from a Norwegian ad-sales page", () => {
  const html = load("newspaper-annonsere.html");
  const got = extractCandidates({
    html,
    sourceUrl: "https://www.avis.no/annonsere",
    pathKind: "sales",
    publisherDomain: "avis.no",
  });
  assert.equal(got.length, 2);
  // primary: ola.nordmann
  assert.equal(got[0].email, "ola.nordmann@avis.no");
  assert.equal(got[0].hints.isMailto, true);
  assert.equal(got[0].hints.pathKind, "sales");
  assert.equal(got[0].hints.hasName, true);
  assert.equal(got[0].hints.emailDomainMatchesPublisher, true);
  assert.equal(got[0].name, "Salgssjef Ola Nordmann");
  // secondary: annonse@avis.no — generic role inbox
  assert.equal(got[1].email, "annonse@avis.no");
});

test("extracts emails from a /kontakt page with table layout", () => {
  const html = load("saleshouse-kontakt.html");
  const got = extractCandidates({
    html,
    sourceUrl: "https://saleshouse.no/kontakt",
    pathKind: "contact",
    publisherDomain: "saleshouse.no",
  });
  const emails = got.map((c) => c.email).sort();
  assert.deepEqual(emails, ["kari@saleshouse.no", "post@saleshouse.no"]);
});

test("returns no candidates from a homepage without emails", () => {
  const html = load("homepage-no-ad-link.html");
  const got = extractCandidates({
    html,
    sourceUrl: "https://www.example.no/",
    pathKind: "homepage",
    publisherDomain: "example.no",
  });
  assert.equal(got.length, 0);
});

test("deduplicates the same email found multiple times on a page", () => {
  const html = `<a href="mailto:x@y.com">x</a> ... contact <a href="mailto:x@y.com">again</a>`;
  const got = extractCandidates({
    html,
    sourceUrl: "https://y.com/c",
    pathKind: "contact",
    publisherDomain: "y.com",
  });
  assert.equal(got.length, 1);
  assert.equal(got[0].email, "x@y.com");
});
