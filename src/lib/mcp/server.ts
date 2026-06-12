import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { authenticateApiKey, hasScope } from "./auth";
import { recordAudit } from "@/lib/audit";
import { readToolDefinitions } from "./tools-read";
import { mutateToolDefinitions } from "./tools-mutate";

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
  const canRead = hasScope(key.scopes, "pricing:admin");
  const canMutate = hasScope(key.scopes, "pricing:admin");
  if (!canRead) return null;

  const server = new McpServer({
    name: "nativespin-pricing",
    version: "1.0.0",
  });

  // Read tools — pricing:admin only (desk-internal data; see gate above)
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

  // Mutation tools — only for pricing:admin
  if (canMutate) {
    const mutators = mutateToolDefinitions(key.createdBy);
    for (const [name, def] of Object.entries(mutators)) {
      const shape = def.parameters.shape;
      server.tool(
        name,
        def.description,
        shape,
        async (args: Record<string, unknown>) => {
          // Record audit row linking the invocation to the API key for traceability
          await recordAudit(key.createdBy, "mcp.tool_invoked", `Tool:${name}`, { apiKeyId: key.id });
          const parsed = def.parameters.parse(args) as unknown;
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
