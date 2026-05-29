import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathsForCountry, scrapePublisher } from "./scraper";

test("pathsForCountry returns locale-specific ad-sales paths", () => {
  assert.deepEqual(
    pathsForCountry("NO").slice(0, 4),
    ["/", "/annonsere", "/annonsorer", "/annonsering"],
  );
  assert.ok(pathsForCountry("DE").includes("/werben"));
  assert.ok(pathsForCountry("FI").includes("/mainosta"));
  assert.ok(pathsForCountry("UK").includes("/advertise"));
});

const FIXTURES = join(process.cwd(), "test-fixtures", "scraper");

test("scrapePublisher aggregates candidates across probed paths and scores them", async () => {
  const annonsere = readFileSync(join(FIXTURES, "newspaper-annonsere.html"), "utf8");
  const home = readFileSync(join(FIXTURES, "homepage-no-ad-link.html"), "utf8");
  const fetcher = async (url: string) => {
    if (url.endsWith("/annonsere")) return { ok: true, status: 200, text: annonsere, contentType: "text/html" };
    return { ok: true, status: 200, text: home, contentType: "text/html" };
  };
  const result = await scrapePublisher({
    publisherId: "pub1",
    rootUrl: "https://www.avis.no",
    countryCode: "NO",
    fetcher,
  });
  assert.ok(result.candidates.length >= 2);
  // Both strong contacts surface high: the dedicated advertising inbox
  // (advertising local part) and the named Salgssjef.
  const byEmail = Object.fromEntries(result.candidates.map((c) => [c.email, c]));
  assert.ok(byEmail["annonse@avis.no"], "advertising inbox found");
  assert.equal(byEmail["annonse@avis.no"].confidence, 100);
  assert.ok(byEmail["ola.nordmann@avis.no"], "named seller found");
  assert.ok(byEmail["ola.nordmann@avis.no"].confidence >= 90);
  // Sorted by confidence descending.
  assert.ok(result.candidates[0].confidence >= result.candidates[1].confidence);
  assert.equal(result.errors.length, 0);
});

test("scrapePublisher tolerates 404s and continues other paths", async () => {
  const annonsere = readFileSync(join(FIXTURES, "newspaper-annonsere.html"), "utf8");
  const fetcher = async (url: string) => {
    if (url.endsWith("/annonsere")) return { ok: true, status: 200, text: annonsere, contentType: "text/html" };
    return { ok: false, status: 404, text: "", contentType: "text/html" };
  };
  const result = await scrapePublisher({
    publisherId: "pub1",
    rootUrl: "https://www.avis.no",
    countryCode: "NO",
    fetcher,
  });
  assert.ok(result.candidates.length >= 1);
});
