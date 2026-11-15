import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEnv, validateEnvAtBoot } from "./env";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

test("checkEnv: an empty dev/CI environment is clean", () => {
  assert.deepEqual(checkEnv(env({})), { invalid: [], missingRequired: [], warnings: [] });
  assert.deepEqual(checkEnv(env({ NODE_ENV: "test", RESEND_API_KEY: "", R2_PUBLIC_URL: "" })).invalid, []);
});

test("checkEnv: production requires DATABASE_URL and AUTH_SECRET", () => {
  const r = checkEnv(env({ NODE_ENV: "production" }));
  assert.deepEqual(r.missingRequired, ["DATABASE_URL", "AUTH_SECRET"]);
  assert.ok(r.warnings.some((w) => w.startsWith("RESEND_API_KEY")));
});

test("checkEnv: malformed values are reported by name", () => {
  const r = checkEnv(env({ OUTREACH_DAILY_CAP: "twenty", NEXT_PUBLIC_SITE_URL: "nativespin.com", CRON_SECRET: "short" }));
  assert.equal(r.invalid.length, 3);
  assert.ok(r.invalid.some((i) => i.startsWith("OUTREACH_DAILY_CAP")));
  assert.ok(r.invalid.some((i) => i.startsWith("NEXT_PUBLIC_SITE_URL")));
  assert.ok(r.invalid.some((i) => i.startsWith("CRON_SECRET")));
});

test("checkEnv: partial R2 config and missing webhook secret are warnings in production", () => {
  const r = checkEnv(
    env({ NODE_ENV: "production", DATABASE_URL: "postgresql://x", AUTH_SECRET: "s".repeat(32), RESEND_API_KEY: "re_x", R2_BUCKET: "b" }),
  );
  assert.deepEqual(r.missingRequired, []);
  assert.ok(r.warnings.some((w) => w.startsWith("RESEND_WEBHOOK_SECRET")));
  assert.ok(r.warnings.some((w) => w.startsWith("R2 partially configured")));
});

test("validateEnvAtBoot: throws only for a production server missing required vars", () => {
  assert.throws(() => validateEnvAtBoot(env({ NODE_ENV: "production" })), /DATABASE_URL, AUTH_SECRET/);
  assert.doesNotThrow(() => validateEnvAtBoot(env({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })));
  assert.doesNotThrow(() => validateEnvAtBoot(env({ NODE_ENV: "development" })));
});
