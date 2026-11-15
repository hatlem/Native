import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReportPeriod, periodDateFilter, periodInputDays } from "./report-period";

const NOW = new Date("2026-11-15T10:00:00.000Z");

test("defaults to the last 12 months", () => {
  const p = parseReportPeriod({}, NOW);
  assert.equal(p.preset, "12m");
  assert.equal(p.from?.toISOString(), "2025-11-15T10:00:00.000Z");
  assert.equal(p.to, null);
  assert.equal(parseReportPeriod({ period: "bogus" }, NOW).preset, "12m");
});

test("presets", () => {
  assert.equal(parseReportPeriod({ period: "30d" }, NOW).from?.toISOString(), "2026-10-16T10:00:00.000Z");
  assert.equal(parseReportPeriod({ period: "90d" }, NOW).from?.toISOString(), "2026-08-17T10:00:00.000Z");
  assert.equal(parseReportPeriod({ period: "ytd" }, NOW).from?.toISOString(), "2026-01-01T00:00:00.000Z");
  const all = parseReportPeriod({ period: "all" }, NOW);
  assert.equal(all.from, null);
  assert.equal(periodDateFilter(all), undefined);
});

test("a custom range is inclusive of both days and wins over a preset", () => {
  const p = parseReportPeriod({ from: "2026-01-01", to: "2026-03-31", period: "30d" }, NOW);
  assert.equal(p.preset, "custom");
  assert.deepEqual(periodDateFilter(p), {
    gte: new Date("2026-01-01T00:00:00.000Z"),
    lt: new Date("2026-04-01T00:00:00.000Z"),
  });
  assert.deepEqual(periodInputDays(p), { from: "2026-01-01", to: "2026-03-31" });
});

test("a one-sided or reversed custom range still makes sense", () => {
  const onlyFrom = parseReportPeriod({ from: "2026-06-01" }, NOW);
  assert.deepEqual(periodDateFilter(onlyFrom), { gte: new Date("2026-06-01T00:00:00.000Z") });
  const reversed = parseReportPeriod({ from: "2026-03-31", to: "2026-01-01" }, NOW);
  assert.deepEqual(periodInputDays(reversed), { from: "2026-01-01", to: "2026-03-31" });
});

test("impossible or malformed dates are ignored", () => {
  assert.equal(parseReportPeriod({ from: "2026-02-31" }, NOW).preset, "12m");
  assert.equal(parseReportPeriod({ from: "01/02/2026" }, NOW).preset, "12m");
  assert.equal(parseReportPeriod({ from: ["2026-01-01"] }, NOW).preset, "12m");
  assert.deepEqual(periodInputDays(parseReportPeriod({ period: "ytd" }, NOW)), { from: "", to: "" });
});
