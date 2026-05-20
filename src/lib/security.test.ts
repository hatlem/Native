import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSecret } from "./security";

test("non-production never throws even with a bad secret", () => {
  assert.doesNotThrow(() =>
    assertSecret({ NODE_ENV: "development", AUTH_SECRET: "change-me" } as NodeJS.ProcessEnv),
  );
  assert.doesNotThrow(() =>
    assertSecret({ NODE_ENV: "test", AUTH_SECRET: "" } as NodeJS.ProcessEnv),
  );
});

test("production refuses missing secret", () => {
  assert.throws(
    () => assertSecret({ NODE_ENV: "production", AUTH_SECRET: "" } as NodeJS.ProcessEnv),
    /AUTH_SECRET/,
  );
});

test("production refuses the placeholder secret", () => {
  assert.throws(
    () => assertSecret({ NODE_ENV: "production", AUTH_SECRET: "change-me" } as NodeJS.ProcessEnv),
    /AUTH_SECRET/,
  );
});

test("production refuses short secrets", () => {
  assert.throws(
    () => assertSecret({ NODE_ENV: "production", AUTH_SECRET: "short" } as NodeJS.ProcessEnv),
    /AUTH_SECRET/,
  );
});

test("production accepts a long, non-placeholder secret", () => {
  assert.doesNotThrow(() =>
    assertSecret({
      NODE_ENV: "production",
      AUTH_SECRET: "a".repeat(32),
    } as NodeJS.ProcessEnv),
  );
});

test("production build-time collection is skipped", () => {
  // Without NEXT_PHASE, this would throw — but build-time must not.
  assert.doesNotThrow(() =>
    assertSecret({
      NODE_ENV: "production",
      NEXT_PHASE: "phase-production-build",
      AUTH_SECRET: "",
    } as NodeJS.ProcessEnv),
  );
});
