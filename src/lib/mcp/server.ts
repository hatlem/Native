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

  const canRead =
    hasScope(key.scopes, "catalog:read") ||
    hasScope(key.scopes, "pricing:admin");
  const canMutate = hasScope(key.scopes, "pricing:admin");
  if (!canRead) return null;

  const server = new McpServer({
    name: "nativespin-pricing",
    version: "1.0.0",
  });

  // Read tools — available to catalog:read and pricing:admin
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
