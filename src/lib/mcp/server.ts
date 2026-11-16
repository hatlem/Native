import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { authenticateApiKey, mcpGrants, redactToolArgs } from "./auth";
import { recordAudit } from "@/lib/audit";
import { readToolDefinitions } from "./tools-read";
import { mutateToolDefinitions, mutateToolLevel, SEND_ARG_TOOLS } from "./tools-mutate";

export async function buildMcpServerForToken(
  rawToken: string,
): Promise<McpServer | null> {
  const key = await authenticateApiKey(rawToken);
  if (!key) return null;

  // The MCP surface is desk-internal tooling only — every read tool
  // exposes negotiation data (Title.commercialExtra, raw net basePrice,
  // sales contacts, quote history) that must never reach buyer/partner
  // keys. catalog:read partners get the public catalog via
  // /api/v1/catalog/*, which serializes an explicit field list.
  //
  // Within the desk surface the grant is tiered (mcpGrants): read, draft,
  // apply. pricing:admin still means all three.
  const grants = mcpGrants(key.scopes);
  if (!grants.read) return null;

  const server = new McpServer({
    name: "nativespin-pricing",
    version: "1.0.0",
  });

  // Read tools — any pricing:* grant (desk-internal data; see gate above)
  for (const [name, def] of Object.entries(readToolDefinitions)) {
    const shape = def.parameters.shape;
    server.tool(
      name,
      def.description,
      shape,
      async (args: Record<string, unknown>) => {
        const parsed = def.parameters.parse(args) as unknown;
        const handler = def.handler as (a: unknown) => Promise<unknown>;
        const result = await handler(parsed);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );
  }

  // Mutation tools — registered only at the level the key was granted, so
  // a read or draft key cannot even see the tools above it.
  if (grants.draft) {
    const mutators = mutateToolDefinitions(key.createdBy);
    for (const [name, def] of Object.entries(mutators)) {
      if (mutateToolLevel(name) === "apply" && !grants.apply) continue;
      const shape = def.parameters.shape;
      server.tool(
        name,
        def.description,
        shape,
        async (args: Record<string, unknown>) => {
          const parsed = def.parameters.parse(args) as unknown;
          // Sending email is an apply-level action even on a draft tool.
          if (
            !grants.apply &&
            SEND_ARG_TOOLS.has(name) &&
            (parsed as { send?: boolean } | null)?.send === true
          ) {
            await recordAudit(key.createdBy, "mcp.tool_refused", `Tool:${name}`, {
              apiKeyId: key.id,
              reason: "send_requires_pricing_apply",
            });
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: "This key may create price requests but not send them (send=true needs the pricing:apply scope). Create it without send and have the desk send it.",
                },
              ],
            };
          }
          // Audit row linking the invocation — and what it was asked to do —
          // to the API key. Arguments are redacted (secrets out, long text cut).
          await recordAudit(key.createdBy, "mcp.tool_invoked", `Tool:${name}`, {
            apiKeyId: key.id,
            args: redactToolArgs(parsed),
          });
          const handler = def.handler as (a: unknown) => Promise<unknown>;
          const result = await handler(parsed);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        },
      );
    }
  }

  return server;
}
