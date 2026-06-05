import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMetricsEmail } from "./email";

test("buildMetricsEmail includes publisher name, link, placement count, and token ref", () => {
  const built = buildMetricsEmail({
    step: "initial",
    locale: "en",
    recipientName: "Kari",
    publisherName: "Acme Media",
    placementCount: 2,
    link: "https://nativespin.com/en/campaign-report/tok123",
    token: "tok123",
  });
  assert.match(built.subject, /Acme Media|campaign|results/i);
  assert.match(built.text, /tok123/);                 // token ref so AI reply attribution works
  assert.match(built.text, /campaign-report\/tok123/);
  assert.match(built.text, /Kari/);
});
