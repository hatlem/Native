// Central description of the server environment, validated once at boot
// (instrumentation-node.ts → validateEnvAtBoot). Until now ~35 variables were
// read ad hoc via process.env in ~75 files, so a typo or a missing value
// surfaced only when the code path that needed it ran in production.
//
// Policy — deliberately conservative so a deploy that works today keeps
// working:
//   - REQUIRED in production (boot fails): DATABASE_URL, AUTH_SECRET.
//   - Everything else is optional. A value that is present but malformed
//     (non-numeric cap, non-URL origin) is reported as an error log line; a
//     production deploy missing something it almost certainly wants (email,
//     webhook secret, storage) gets one warning listing what is off.
//   - Dev, test, CI and `next build` never fail here.
//
// Call sites still read process.env directly; this module is the single
// place that documents and checks the contract. Keep .env.example in sync.
import { z } from "zod";
import { log } from "@/lib/log";

const optionalString = z.string().trim().min(1).optional();
const optionalUrl = z
  .string()
  .trim()
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an http(s) URL")
  .optional();
const optionalInt = z
  .string()
  .trim()
  .regex(/^\d+$/, "must be a non-negative integer")
  .optional();
const flag = z.enum(["0", "1"]).optional();

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),

  // --- Core ---
  DATABASE_URL: optionalString,
  ALLOW_LOCAL_DB: flag,
  AUTH_SECRET: optionalString,
  AUTH_URL: optionalUrl,
  NEXTAUTH_URL: optionalUrl,
  NEXT_PUBLIC_SITE_URL: optionalUrl,
  NEXT_PUBLIC_APP_NAME: optionalString,

  // --- Email (Resend) ---
  RESEND_API_KEY: optionalString,
  RESEND_WEBHOOK_SECRET: optionalString,
  AUTH_EMAIL_FROM: optionalString,
  AUTH_EMAIL_REPLY_TO: optionalString,
  AUTH_APP_NAME: optionalString,
  CONTACT_INBOX: optionalString,
  EMAIL_LOG_BODY: flag,

  // --- Outreach / metrics campaigns ---
  OUTREACH_DAILY_CAP: optionalInt,
  OUTREACH_HOURLY_CAP: optionalInt,
  OUTREACH_FROM: optionalString,
  OUTREACH_REPLY_TO: optionalString,
  METRICS_DAILY_CAP: optionalInt,
  METRICS_REPLY_TO: optionalString,
  CAMPAIGN_FLOW: flag,

  // --- Blob storage (Cloudflare R2) ---
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET: optionalString,
  R2_PUBLIC_URL: optionalUrl,

  // --- GetPlatform (offers, feedback, LLM gateway) ---
  GETPLATFORM_URL: optionalUrl,
  GETPLATFORM_API_KEY: optionalString,
  GETPLATFORM_AI_URL: optionalUrl,
  GETPLATFORM_AI_KEY: optionalString,
  AI_MODEL_BRIEF_MATCH: optionalString,
  AI_MODEL_BRIEF_RERANK: optionalString,
  AI_MODEL_PREVIEW: optionalString,
  AI_DAILY_BUDGET_GLOBAL: optionalInt,
  AI_DAILY_BUDGET_PER_ORG: optionalInt,
  FEEDBACK_INGEST_KEY: optionalString,

  // --- Accounting ---
  ACCOUNTING_PROVIDER: optionalString,
  FIKEN_API_TOKEN: optionalString,
  FIKEN_COMPANY_SLUG: optionalString,

  // --- Jobs & operations ---
  IN_PROCESS_SWEEPS: flag,
  JOB_WORKER: flag,
  AUTOSEND_SWEEP: flag,
  METRICS_SWEEP: flag,
  PRICE_BAND_SWEEP: flag,
  PLACEMENT_READY_SWEEP: flag,
  RETENTION_SWEEP: flag,
  CRON_SECRET: z.string().min(24, "must be at least 24 characters").optional(),
  ERROR_WEBHOOK_URL: optionalUrl,
});

export type Env = z.infer<typeof envSchema>;

export type EnvReport = {
  // Present-but-malformed values, as "NAME: reason".
  invalid: string[];
  // Required in production and absent.
  missingRequired: string[];
  // Production deploy that will run degraded, as human-readable notes.
  warnings: string[];
};

// Empty strings are how .env.example ships unset values ("RESEND_API_KEY=");
// treat them as absent rather than as invalid.
function normalize(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(envSchema.shape)) {
    const v = env[key];
    out[key] = v === undefined || v.trim() === "" ? undefined : v;
  }
  return out;
}

// Pure: no logging, no throwing. Exported for tests.
export function checkEnv(env: NodeJS.ProcessEnv = process.env): EnvReport {
  const values = normalize(env);
  const parsed = envSchema.safeParse(values);
  const invalid = parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

  const isProd = env.NODE_ENV === "production";
  const missingRequired: string[] = [];
  const warnings: string[] = [];
  if (isProd) {
    for (const key of ["DATABASE_URL", "AUTH_SECRET"]) {
      if (!values[key]) missingRequired.push(key);
    }
    if (!values.RESEND_API_KEY) warnings.push("RESEND_API_KEY unset: emails are only logged, not sent");
    if (values.RESEND_API_KEY && !values.RESEND_WEBHOOK_SECRET)
      warnings.push("RESEND_WEBHOOK_SECRET unset: bounce/complaint webhooks are rejected, suppression list will not update");
    const r2 = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
    const r2Set = r2.filter((k) => values[k]);
    if (r2Set.length > 0 && r2Set.length < r2.length)
      warnings.push(`R2 partially configured: missing ${r2.filter((k) => !values[k]).join(", ")}`);
    if (!values.NEXT_PUBLIC_SITE_URL && !values.AUTH_URL)
      warnings.push("NEXT_PUBLIC_SITE_URL/AUTH_URL unset: absolute links fall back to http://localhost:3000");
    if (values.ACCOUNTING_PROVIDER === "fiken" && (!values.FIKEN_API_TOKEN || !values.FIKEN_COMPANY_SLUG))
      warnings.push("ACCOUNTING_PROVIDER=fiken but FIKEN_API_TOKEN/FIKEN_COMPANY_SLUG unset");
    if (values.JOB_WORKER === "0" && !values.CRON_SECRET)
      warnings.push("JOB_WORKER=0 without CRON_SECRET: nothing drains the job queue (/api/cron/sweeps is off)");
    if (values.IN_PROCESS_SWEEPS === "0" && !values.CRON_SECRET)
      warnings.push("IN_PROCESS_SWEEPS=0 without CRON_SECRET: no scheduler can run the sweeps");
    if (!values.ERROR_WEBHOOK_URL) warnings.push("ERROR_WEBHOOK_URL unset: errors are logged but nobody is alerted");
  }
  return { invalid, missingRequired, warnings };
}

// Boot-time check. Throws only when a production server is missing a
// required variable; everything else is reported through the logger.
export function validateEnvAtBoot(env: NodeJS.ProcessEnv = process.env): EnvReport {
  const report = checkEnv(env);
  // `next build` evaluates server modules without the runtime environment.
  if (env.NEXT_PHASE === "phase-production-build") return report;
  if (report.invalid.length > 0) log.error("env.invalid", { issues: report.invalid });
  if (report.warnings.length > 0) log.warn("env.degraded", { warnings: report.warnings });
  if (report.missingRequired.length > 0) {
    throw new Error(
      `Missing required environment variables in production: ${report.missingRequired.join(", ")}. See .env.example.`,
    );
  }
  return report;
}
