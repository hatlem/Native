// Which gateway model each AI feature uses, and the spend guards around
// them — one place, overridable from the environment, so swapping a model
// (or a provider behind the gateway) is a config change, not a code change.

type Env = Record<string, string | undefined>;

export type AiFeature = "brief-match" | "brief-rerank" | "preview";

const MODEL_DEFAULTS: Record<AiFeature, { env: string; model: string }> = {
  // Facet extraction from a buyer's brief.
  "brief-match": { env: "AI_MODEL_BRIEF_MATCH", model: "claude-sonnet-4-6" },
  // Short grounded "why it fits" reasons — the cheap, fast tier.
  "brief-rerank": { env: "AI_MODEL_BRIEF_RERANK", model: "claude-haiku-4-5" },
  // The public "preview your native ad" article.
  preview: { env: "AI_MODEL_PREVIEW", model: "claude-sonnet-4-6" },
};

export function aiModel(feature: AiFeature, env: Env = process.env): string {
  const def = MODEL_DEFAULTS[feature];
  return env[def.env]?.trim() || def.model;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// LLM calls allowed per UTC day. Over budget the AI paths simply are not
// attempted and every caller falls back to its deterministic result.
export function aiDailyBudgets(env: Env = process.env): { global: number; perScope: number } {
  return {
    // Every feature, every customer and the public preview together.
    global: positiveInt(env.AI_DAILY_BUDGET_GLOBAL, 3000),
    // One organisation (or one user without an organisation).
    perScope: positiveInt(env.AI_DAILY_BUDGET_PER_ORG, 300),
  };
}
