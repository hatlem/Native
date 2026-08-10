// Optional LLM rerank step for the brief matcher: turns the deterministic
// facet-chip reasons ("B2B · Tech") into one grounded, natural-language
// sentence per title, in the buyer's locale.
//
// This never reorders the deterministic ranking — brief-match.ts's scoring
// stays the sole authority on WHICH titles are picked and in what order.
// The model is only asked to explain the titles it's given, grounded in the
// metadata supplied for each one (never inventing facts).
//
// Strictly optional and fail-open: with no gateway key, on timeout, or on
// any error/malformed output it returns an empty Map so the caller falls
// back to the existing facet-chip reasons. It never throws to the caller.

import {
  gatewayChat,
  gatewayConfigured,
  type GatewayModel,
  type GatewayTool,
} from "@/lib/gateway-chat";

const MODEL: GatewayModel = "claude-haiku-4-5";
// Reasoning generation over an already-short candidate list; kept tight so a
// slow gateway can't stall the campaign recommender — callers stay
// deterministic-only (existing chip reasons) on timeout.
const TIMEOUT_MS = 8000;
const MAX_CANDIDATES = 30;
const MAX_REASON_LEN = 140;

export type RerankCandidate = {
  titleId: string;
  name: string;
  vertical: string | null;
  audience: string | null;
  category: string | null;
  description?: string | null;
  keywords?: string[];
  // The picked product's publisher-stated inclusions, when known — the most
  // concrete thing we can ground a reason in.
  includedText?: string | null;
};

const LOCALE_NAMES: Record<string, string> = {
  en: "English",
  no: "Norwegian",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
  de: "German",
};

function localeName(locale: string): string {
  return LOCALE_NAMES[locale] ?? "English";
}

function truncate(s: string | null | undefined, max: number): string {
  const t = s?.trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function buildSystemPrompt(locale: string): string {
  return `You write short, grounded, one-sentence reasons why each already-selected native-advertising title fits a media buyer's brief. Use ONLY the facts given for each title (its vertical, audience, category, description, keywords, or what the ad product includes) — never invent numbers, audiences, or claims not present in the data. Keep each reason under ${MAX_REASON_LEN} characters, concrete and specific, not generic praise like "great fit" or "perfect match". Write every reason in ${localeName(locale)}. Call the rank_titles tool once with one entry per title id you were given, in any order.`;
}

const TOOL: GatewayTool = {
  name: "rank_titles",
  description: "Return one grounded reason sentence per given title id.",
  input_schema: {
    type: "object",
    properties: {
      ranked: {
        type: "array",
        items: {
          type: "object",
          properties: {
            titleId: { type: "string" },
            reason: { type: "string" },
          },
          required: ["titleId", "reason"],
        },
      },
    },
    required: ["ranked"],
  },
};

function buildUserMessage(candidates: RerankCandidate[], brief: string): string {
  const lines = candidates.map((c, i) => {
    const parts = [
      `${i + 1}. titleId=${c.titleId}`,
      `name=${c.name}`,
      c.vertical ? `vertical=${c.vertical}` : null,
      c.audience ? `audience=${c.audience}` : null,
      c.category ? `category=${c.category}` : null,
      c.description ? `description=${truncate(c.description, 200)}` : null,
      c.keywords?.length ? `keywords=${c.keywords.slice(0, 8).join(", ")}` : null,
      c.includedText ? `productIncludes=${truncate(c.includedText, 150)}` : null,
    ].filter(Boolean);
    return parts.join(" | ");
  });
  const briefLine = brief.trim() ? `Buyer brief: ${brief.trim().slice(0, 1000)}\n\n` : "";
  return `${briefLine}Titles already selected for this buyer:\n${lines.join("\n")}`;
}

export function rerankAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return gatewayConfigured(env);
}

// Coerce arbitrary tool-call output into a safe titleId -> reason map. Drops
// anything not in `validIds`, caps reason length, and ignores malformed
// entries entirely rather than throwing — callers simply won't have a
// reasonText for those titles and fall back to the deterministic chips.
export function sanitizeRerankOutput(
  raw: unknown,
  validIds: ReadonlySet<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw || typeof raw !== "object") return out;
  const ranked = (raw as { ranked?: unknown }).ranked;
  if (!Array.isArray(ranked)) return out;
  for (const entry of ranked) {
    if (!entry || typeof entry !== "object") continue;
    const { titleId, reason } = entry as { titleId?: unknown; reason?: unknown };
    if (typeof titleId !== "string" || !validIds.has(titleId)) continue;
    if (typeof reason !== "string") continue;
    const trimmed = reason.trim();
    if (!trimmed) continue;
    if (out.has(titleId)) continue; // first occurrence wins
    out.set(titleId, trimmed.slice(0, MAX_REASON_LEN));
  }
  return out;
}

// Grounded per-title reasons for an already-ranked candidate list. Returns a
// titleId -> reason Map; entries the model omitted (or that fail
// sanitization) are simply absent — never throws, never reorders.
export async function rerankBriefMatches(
  candidates: RerankCandidate[],
  locale: string = "en",
  brief: string = "",
): Promise<Map<string, string>> {
  if (candidates.length === 0) return new Map();
  const capped = candidates.slice(0, MAX_CANDIDATES);

  const result = await gatewayChat({
    entityId: "nativespin-system",
    model: MODEL,
    system: buildSystemPrompt(locale),
    messages: [{ role: "user", content: buildUserMessage(capped, brief) }],
    maxTokens: 1500,
    timeoutMs: TIMEOUT_MS,
    tools: [TOOL],
  });
  if (!result || result.toolInput === undefined) return new Map(); // fail-open

  return sanitizeRerankOutput(result.toolInput, new Set(capped.map((c) => c.titleId)));
}
