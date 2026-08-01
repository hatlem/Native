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

/** Gateway model slugs NativeSpin uses (see the gateway's llm_models table). */
export type GatewayModel = "claude-sonnet-5" | "claude-sonnet-4-6" | "claude-haiku-4-5";

export interface GatewayTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface GatewayChatParams {
  /** Stable entity for attribution, e.g. "nativespin-preview". */
  entityId: string;
  model: GatewayModel;
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

/**
 * Call the gateway. Returns null on any failure (missing key, non-2xx,
 * timeout, malformed body) so every caller can stay fail-open — the AI paths
 * here are enrichment, never load-bearing.
 */
export async function gatewayChat(params: GatewayChatParams): Promise<GatewayChatResult | null> {
  const apiKey = process.env.GETPLATFORM_AI_KEY || process.env.GETPLATFORM_API_KEY;
  if (!apiKey) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), params.timeoutMs ?? 12000);
  try {
    const res = await fetch(`${GETPLATFORM_AI_URL}/api/ai/chat`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        platform: PLATFORM,
        entityId: params.entityId,
        model: params.model,
        maxTokens: params.maxTokens ?? 1024,
        ...(params.system ? { system: params.system } : {}),
        messages: params.messages,
        ...(params.tools
          ? { tools: params.tools, tool_choice: { type: "tool", name: params.tools[0].name } }
          : {}),
      }),
    });
    if (!res.ok) {
      console.warn(`[nativespin] gateway chat failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      content?: string;
      contentBlocks?: { type: string; name?: string; input?: unknown }[];
    };
    const toolName = params.tools?.[0]?.name;
    const call = toolName
      ? data.contentBlocks?.find((b) => b.type === "tool_use" && b.name === toolName)
      : undefined;
    return { text: data.content ?? "", ...(call ? { toolInput: call.input } : {}) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
