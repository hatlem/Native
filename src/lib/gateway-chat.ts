import { log } from "@/lib/log";
import { aiModel, type AiFeature } from "@/lib/ai-config";
// Client for the GetPlatform central LLM gateway (/api/ai/chat).
//
// NativeSpin routes ALL its LLM calls through the gateway instead of calling
// api.anthropic.com directly. The gateway holds the provider key, meters every
// call in the central AiUsage ledger (platform="nativespin") and enforces model
// availability and spend controls — so NativeSpin needs no ANTHROPIC_API_KEY of
// its own and a provider key rotation can never silently degrade its AI paths.

const GETPLATFORM_AI_URL =
  process.env.GETPLATFORM_AI_URL || "https://get-platform-production.up.railway.app";

const PLATFORM = "nativespin";

/** A gateway model slug (see the gateway's llm_models table). Which slug
 *  each feature uses is configuration — lib/ai-config.ts. */
export type GatewayModel = string;

export interface GatewayTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface GatewayChatParams {
  /** Which AI feature is calling — picks the model (lib/ai-config.ts) and
   *  labels the usage log. */
  feature: AiFeature;
  /** On whose behalf: "org:<id>" | "user:<id>" | "anon" (lib/ai-usage.ts).
   *  Drives the per-customer daily budget and the gateway's attribution. */
  scope?: string;
  /** Overrides the feature's configured model. */
  model?: GatewayModel;
  messages: { role: "user" | "assistant"; content: string }[];
  system?: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** When set, the model is forced to call tools[0] and toolInput is returned. */
  tools?: GatewayTool[];
}

export interface GatewayChatResult {
  text: string;
  /** Parsed input of the forced tool call, when `tools` was supplied. */
  toolInput?: unknown;
}

/**
 * True when a gateway key is configured. Mirrors the old ANTHROPIC_API_KEY
 * gate: callers use it to decide whether to attempt AI at all.
 */
export function gatewayConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !!(env.GETPLATFORM_AI_KEY || env.GETPLATFORM_API_KEY);
}

// What the gateway's usage ledger attributes the call to: the customer
// organisation when there is one, so cost can be read per customer; the
// feature otherwise. Never a user id or an IP.
export function gatewayEntityId(feature: AiFeature, scope: string | undefined): string {
  return scope?.startsWith("org:") ? `nativespin-org-${scope.slice(4)}` : `nativespin-${feature}`;
}

/**
 * Call the gateway. Returns null on any failure (missing key, over the daily
 * budget, non-2xx, timeout, malformed body) so every caller can stay
 * fail-open — the AI paths here are enrichment, never load-bearing.
 *
 * Every call is budgeted and logged (lib/ai-usage.ts): feature, scope,
 * outcome and latency, counted against the caller's and the global daily
 * budget before the request is made.
 */
export async function gatewayChat(params: GatewayChatParams): Promise<GatewayChatResult | null> {
  const apiKey = process.env.GETPLATFORM_AI_KEY || process.env.GETPLATFORM_API_KEY;
  if (!apiKey) return null;

  const model = params.model ?? aiModel(params.feature);
  const scope = params.scope ?? "anon";
  // Loaded lazily: the budget lives in the database, and modules that only
  // import this file for its types/sanitisers must not pull Prisma in.
  const { withAiBudget } = await import("@/lib/ai-usage");
  return withAiBudget({ feature: params.feature, model, scope }, () =>
    callGateway(params, apiKey, model, scope),
  );
}

async function callGateway(
  params: GatewayChatParams,
  apiKey: string,
  model: string,
  scope: string,
): Promise<{ value: GatewayChatResult | null; outcome: "ok" | "failed" | "timeout" }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), params.timeoutMs ?? 12000);
  try {
    const res = await fetch(`${GETPLATFORM_AI_URL}/api/ai/chat`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        platform: PLATFORM,
        entityId: gatewayEntityId(params.feature, scope),
        model,
        maxTokens: params.maxTokens ?? 1024,
        ...(params.system ? { system: params.system } : {}),
        messages: params.messages,
        ...(params.tools
          ? { tools: params.tools, tool_choice: { type: "tool", name: params.tools[0].name } }
          : {}),
      }),
    });
    if (!res.ok) {
      log.warn("gateway_chat.failed", { status: res.status, feature: params.feature });
      return { value: null, outcome: "failed" };
    }
    const data = (await res.json()) as {
      content?: string;
      contentBlocks?: { type: string; name?: string; input?: unknown }[];
    };
    const toolName = params.tools?.[0]?.name;
    const call = toolName
      ? data.contentBlocks?.find((b) => b.type === "tool_use" && b.name === toolName)
      : undefined;
    return {
      value: { text: data.content ?? "", ...(call ? { toolInput: call.input } : {}) },
      outcome: "ok",
    };
  } catch {
    return { value: null, outcome: ctrl.signal.aborted ? "timeout" : "failed" };
  } finally {
    clearTimeout(timer);
  }
}
